/**
 * OAuth for remote MCP servers, through the MCP SDK's client provider. The
 * browser redirect comes back to a one-shot loopback server on a fixed port,
 * since dynamically registered clients are bound to their redirect URI.
 */
import crypto from "node:crypto";
import http from "node:http";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

export const OAUTH_CALLBACK_PORT = 33418;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export interface OAuthState {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
}

export class ConnectorOAuth implements OAuthClientProvider {
  private readonly stateValue = crypto.randomBytes(16).toString("hex");
  private authorizationUrl: URL | null = null;

  constructor(
    private readonly load: () => OAuthState,
    private readonly save: (state: OAuthState) => void,
    private readonly openExternal: (url: string) => void,
  ) {}

  get redirectUrl(): string {
    return `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Atelier",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    return this.stateValue;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.load().client;
  }

  saveClientInformation(client: OAuthClientInformationMixed): void {
    this.save({ ...this.load(), client });
  }

  tokens(): OAuthTokens | undefined {
    return this.load().tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.save({ ...this.load(), tokens });
  }

  /** The SDK calls this, then throws UnauthorizedError; `waitForCode` opens the browser. */
  redirectToAuthorization(url: URL): void {
    this.authorizationUrl = url;
  }

  saveCodeVerifier(verifier: string): void {
    this.save({ ...this.load(), verifier });
  }

  codeVerifier(): string {
    const v = this.load().verifier;
    if (!v) throw new Error("No PKCE verifier saved for this sign-in.");
    return v;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    const s = this.load();
    if (scope === "all") return this.save({});
    if (scope === "client") return this.save({ ...s, client: undefined });
    if (scope === "tokens") return this.save({ ...s, tokens: undefined });
    if (scope === "verifier") return this.save({ ...s, verifier: undefined });
  }

  get pendingSignIn(): boolean {
    return this.authorizationUrl !== null;
  }

  /** Opens the sign-in page and resolves with the authorization code from the redirect. */
  waitForCode(signal?: AbortSignal): Promise<string> {
    const url = this.authorizationUrl;
    if (!url) return Promise.reject(new Error("The server did not start a sign-in."));
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
      return Promise.reject(new Error("The sign-in page must use https."));
    }
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const u = new URL(req.url ?? "/", this.redirectUrl);
        if (u.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const error = u.searchParams.get("error");
        const code = u.searchParams.get("code");
        const ok = !error && code && u.searchParams.get("state") === this.stateValue;
        res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Atelier</title><body style="font:15px system-ui;padding:48px">${
            ok ? "Signed in. You can close this tab and return to Atelier." : "Sign-in failed. Return to Atelier and try again."
          }</body>`,
        );
        finish(ok ? null : new Error(error ? `Sign-in failed: ${error}` : "Sign-in response did not match this request."), code ?? "");
      });
      const timer = setTimeout(() => finish(new Error("Sign-in timed out.")), SIGN_IN_TIMEOUT_MS);
      const onAbort = () => finish(new Error("Sign-in cancelled."));
      signal?.addEventListener("abort", onAbort, { once: true });
      let done = false;
      const finish = (err: Error | null, code = "") => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.authorizationUrl = null;
        server.close();
        if (err) reject(err);
        else resolve(code);
      };
      server.on("error", (err: NodeJS.ErrnoException) =>
        finish(err.code === "EADDRINUSE" ? new Error(`Port ${OAUTH_CALLBACK_PORT} is in use, so sign-in can't receive its redirect.`) : err),
      );
      // Loopback only: nothing outside this computer can reach the callback.
      server.listen(OAUTH_CALLBACK_PORT, "127.0.0.1", () => this.openExternal(url.toString()));
    });
  }
}
