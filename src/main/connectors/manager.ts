/**
 * Live connections to connectors. MCP servers connect lazily (on "Connect" in
 * Settings, or the first build turn that needs them) and stay open until the
 * connector changes or the app quits.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ConnectorConfig, ConnectorState } from "@shared/connectors";
import { clampText, type ToolImage, type ToolOutput } from "../chat/tools";
import { callFigmaTool, checkFigmaToken, FIGMA_TOOLS } from "./figma";
import { ConnectorOAuth, type OAuthState } from "./oauth";
import { runtimeCommand, runtimeEnv, type NodeRuntime } from "../node/runtimes";

const CONNECT_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 120_000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export interface RawTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean | null;
}

export interface ConnectorSecrets {
  token?: string;
  env?: Record<string, string>;
}

export interface ManagerDeps {
  config(id: string): ConnectorConfig;
  secrets(id: string): Promise<ConnectorSecrets>;
  /** Loads OAuth into the sync cache the SDK reads. */
  prepare(id: string): Promise<void>;
  /** Waits for in-flight OAuth encrypts. */
  flush(id: string): Promise<void>;
  loadOAuth(id: string): OAuthState;
  saveOAuth(id: string, state: OAuthState): void;
  openExternal(url: string): void;
  onChange(id: string): void;
  /** Atelier's Node.js, for servers started with node, npm or npx. */
  nodeRuntime?(): Promise<NodeRuntime>;
}

const NODE_PROGRAMS = new Set(["node", "npm", "npx"]);

interface Live {
  state: ConnectorState;
  message?: string;
  tools: RawTool[];
  client?: Client;
  connecting?: Promise<void>;
  /** Last stderr lines of a local server, to explain failures. */
  stderr: string;
}

export class ConnectorManager {
  private live = new Map<string, Live>();

  constructor(private readonly deps: ManagerDeps) {}

  status(id: string): Pick<Live, "state" | "message" | "tools"> {
    const l = this.live.get(id);
    return l ? { state: l.state, message: l.message, tools: l.tools } : { state: "idle", tools: [] };
  }

  /** Connects if needed; resolves once connected, throws otherwise. */
  async ensure(id: string): Promise<RawTool[]> {
    const l = this.live.get(id);
    if (l?.state === "connected") return l.tools;
    await (l?.connecting ?? this.connect(id));
    const after = this.live.get(id)!;
    if (after.state !== "connected") throw new Error(after.message ?? "Not connected");
    return after.tools;
  }

  /** (Re)connects and lists tools. Errors end up in the status, not thrown. */
  connect(id: string): Promise<void> {
    const existing = this.live.get(id);
    if (existing?.connecting) return existing.connecting;
    const l: Live = { state: "connecting", tools: [], stderr: "" };
    const previous = existing?.client;
    this.live.set(id, l);
    this.deps.onChange(id);
    l.connecting = (async () => {
      await previous?.close().catch(() => {});
      try {
        await this.open(id, l);
        l.state = "connected";
        l.message = undefined;
      } catch (err) {
        await l.client?.close().catch(() => {});
        l.client = undefined;
        l.state = "error";
        l.message = describe(err, l.stderr);
      } finally {
        l.connecting = undefined;
        this.deps.onChange(id);
      }
    })();
    return l.connecting;
  }

  async disconnect(id: string): Promise<void> {
    const l = this.live.get(id);
    this.live.delete(id);
    await l?.client?.close().catch(() => {});
    this.deps.onChange(id);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.live.keys()].map((id) => this.disconnect(id)));
  }

  async call(id: string, tool: string, input: unknown, signal: AbortSignal): Promise<ToolOutput> {
    const config = this.deps.config(id);
    if (config.kind === "figma-api") {
      const token = (await this.deps.secrets(id)).token;
      if (!token) throw new Error("Add a Figma token to this connector.");
      return callFigmaTool(token, tool, input, signal);
    }
    await this.ensure(id);
    const client = this.live.get(id)?.client;
    if (!client) throw new Error("The connector is not connected.");
    const result = await client.callTool({ name: tool, arguments: (input ?? {}) as Record<string, unknown> }, undefined, {
      signal,
      timeout: CALL_TIMEOUT_MS,
    });
    return toOutput(result as { content?: unknown[]; structuredContent?: unknown; isError?: boolean; toolResult?: unknown });
  }

  private async open(id: string, l: Live): Promise<void> {
    await this.deps.prepare(id);
    try {
      await this.openAfterPrepare(id, l);
    } finally {
      await this.deps.flush(id);
    }
  }

  private async openAfterPrepare(id: string, l: Live): Promise<void> {
    const config = this.deps.config(id);
    const secrets = await this.deps.secrets(id);

    if (config.kind === "figma-api") {
      if (!secrets.token) throw new Error("Add a Figma personal access token.");
      const user = await checkFigmaToken(secrets.token, AbortSignal.timeout(CONNECT_TIMEOUT_MS));
      l.tools = FIGMA_TOOLS.map((t) => ({ ...t, readOnly: true }));
      l.message = `Signed in as ${user}`;
      return;
    }

    const connectWith = async (transport: Transport) => {
      const client = new Client({ name: "Atelier", version: "0.1.0" });
      client.onclose = () => {
        if (this.live.get(id) === l && l.state === "connected") {
          l.state = "idle";
          l.client = undefined;
          l.message = "Disconnected";
          this.deps.onChange(id);
        }
      };
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, "Connecting timed out.");
      l.client = client;
      l.tools = await listAllTools(client);
    };

    if (config.kind === "mcp-stdio") {
      if (!config.command) throw new Error("Set the command that starts the server.");
      // The login shell PATH (read at startup) finds uvx, docker and friends.
      let command = { command: config.command, args: config.args ?? [] };
      let env: Record<string, string> = { ...getDefaultEnvironment(), PATH: process.env.PATH ?? "", ...(secrets.env ?? {}) };
      if (NODE_PROGRAMS.has(config.command) && this.deps.nodeRuntime) {
        const rt = await this.deps.nodeRuntime();
        command = runtimeCommand(rt, command.command, command.args);
        env = runtimeEnv(rt, env) as Record<string, string>;
      }
      const transport = new StdioClientTransport({
        ...command,
        env,
        stderr: "pipe",
      });
      transport.stderr?.on("data", (chunk: Buffer) => {
        l.stderr = (l.stderr + chunk.toString()).slice(-2000);
      });
      await connectWith(transport);
      return;
    }

    // Remote: Streamable HTTP first, then the older SSE transport.
    if (!config.url) throw new Error("Set the server URL.");
    const url = new URL(config.url);
    const oauth =
      config.auth === "oauth"
        ? new ConnectorOAuth(() => this.deps.loadOAuth(id), (s) => this.deps.saveOAuth(id, s), this.deps.openExternal)
        : undefined;
    const headers: Record<string, string> = config.auth === "bearer" && secrets.token ? { Authorization: `Bearer ${secrets.token}` } : {};
    const options = { authProvider: oauth, requestInit: { headers } };

    try {
      await connectWith(new StreamableHTTPClientTransport(url, options));
      return;
    } catch (err) {
      if (err instanceof UnauthorizedError && oauth?.pendingSignIn) {
        l.state = "needs-auth";
        l.message = "Finish signing in in your browser.";
        this.deps.onChange(id);
        const code = await oauth.waitForCode();
        const transport = new StreamableHTTPClientTransport(url, options);
        await transport.finishAuth(code);
        l.state = "connecting";
        l.message = undefined;
        this.deps.onChange(id);
        await connectWith(new StreamableHTTPClientTransport(url, options));
        return;
      }
      if (err instanceof UnauthorizedError) throw new Error("The server requires sign-in. Choose OAuth or add a bearer token.");
      try {
        await connectWith(new SSEClientTransport(url, options));
      } catch {
        throw err;
      }
    }
  }
}

async function listAllTools(client: Client): Promise<RawTool[]> {
  const out: RawTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    for (const t of page.tools) {
      out.push({
        name: t.name,
        description: t.description ?? t.title ?? "",
        inputSchema: t.inputSchema as Record<string, unknown>,
        readOnly: typeof t.annotations?.readOnlyHint === "boolean" ? t.annotations.readOnlyHint : null,
      });
    }
    cursor = page.nextCursor;
  } while (cursor && out.length < 500);
  return out;
}

/** Flattens MCP content into text plus images. */
export function toOutput(result: { content?: unknown[]; structuredContent?: unknown; isError?: boolean; toolResult?: unknown }): ToolOutput {
  const parts: string[] = [];
  const images: ToolImage[] = [];
  for (const raw of result.content ?? []) {
    const c = raw as { type: string; text?: string; data?: string; mimeType?: string; uri?: string; name?: string; resource?: { uri?: string; text?: string; mimeType?: string } };
    if (c.type === "text" && c.text) parts.push(c.text);
    else if (c.type === "image" && c.data && c.mimeType && IMAGE_TYPES.has(c.mimeType) && images.length < 4) {
      images.push({ mediaType: c.mimeType as ToolImage["mediaType"], data: c.data });
    } else if (c.type === "resource" && c.resource) {
      parts.push(c.resource.text ?? `[resource ${c.resource.uri ?? ""} (${c.resource.mimeType ?? "binary"})]`);
    } else if (c.type === "resource_link") parts.push(`[resource link: ${c.name ?? ""} ${c.uri ?? ""}]`);
  }
  if (parts.length === 0 && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent, null, 1));
  if (parts.length === 0 && result.toolResult !== undefined) parts.push(JSON.stringify(result.toolResult, null, 1));
  return { text: clampText(parts.join("\n\n")), images, isError: Boolean(result.isError) };
}

function describe(err: unknown, stderr: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code;
  if (cause === "ECONNREFUSED") return "Nothing is listening at this URL. Make sure the server is running.";
  if (cause === "ENOENT") return "The command was not found. Check it is installed and on your PATH.";
  const tail = stderr.trim().split("\n").slice(-3).join("\n");
  return tail ? `${msg}\n${tail}` : msg;
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)))]).finally(() =>
    clearTimeout(timer),
  );
}
