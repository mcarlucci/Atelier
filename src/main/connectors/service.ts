/**
 * Connector settings (stored with encrypted secrets) and the toolset a build
 * turn gets from them.
 */
import { defaultToolEnabled, type ConnectorConfig, type ConnectorInput, type ConnectorKind, type ConnectorView } from "@shared/connectors";
import type { Toolset, ToolSpec } from "../chat/tools";
import type { SecretBox } from "../services";
import { newId, type Store, type StoredConnector } from "../store";
import { ConnectorManager, type ConnectorSecrets } from "./manager";
import type { OAuthState } from "./oauth";
import type { NodeRuntime } from "../node/runtimes";

const KINDS: ConnectorKind[] = ["mcp-stdio", "mcp-http", "figma-api"];
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ConnectorServiceDeps {
  store: Store;
  secrets: SecretBox;
  openExternal(url: string): void;
  onChange(view: ConnectorView | { id: string; deleted: true }): void;
  designSystemExists(id: string): boolean;
  nodeRuntime?(): Promise<NodeRuntime>;
}

export class ConnectorService {
  readonly manager: ConnectorManager;
  private oauthState = new Map<string, OAuthState>();
  private oauthPersist = new Map<string, Promise<void>>();

  constructor(private readonly deps: ConnectorServiceDeps) {
    this.manager = new ConnectorManager({
      config: (id) => this.view(id),
      secrets: (id) => this.secrets(id),
      prepare: (id) => this.hydrateOAuth(id),
      flush: (id) => this.oauthPersist.get(id) ?? Promise.resolve(),
      loadOAuth: (id) => this.oauthState.get(id) ?? {},
      saveOAuth: (id, state) => this.persistOAuth(id, state),
      openExternal: deps.openExternal,
      nodeRuntime: deps.nodeRuntime,
      onChange: (id) => {
        if (this.find(id)) deps.onChange(this.view(id));
      },
    });
  }

  list(): ConnectorView[] {
    return (this.deps.store.get().connectors ?? []).map((c) => this.view(c.id));
  }

  async save(input: ConnectorInput): Promise<ConnectorView> {
    const clean = this.validate(input);
    const existing = input.id ? this.find(input.id) : undefined;
    if (input.id && !existing) throw new Error("Connector not found");
    const id = existing?.id ?? newId();
    const before = existing ? JSON.stringify(connectionFields(existing)) : "";
    const secret = input.secret?.trim();
    const encryptedSecret = input.secret === undefined ? undefined : secret ? await this.deps.secrets.encrypt(secret) : undefined;
    const env = input.env !== undefined && clean.kind === "mcp-stdio" ? (input.env ?? {}) : undefined;
    const encryptedEnv = env === undefined ? undefined : Object.keys(env).length ? await this.deps.secrets.encrypt(JSON.stringify(env)) : undefined;

    this.deps.store.update((d) => {
      const list = (d.connectors ??= []);
      let c = list.find((x) => x.id === id);
      if (!c) {
        c = { id, toolOverrides: {}, ...clean };
        list.push(c);
      } else {
        Object.assign(c, clean);
        // Fields that only apply to another kind are dropped.
        if (clean.kind !== "mcp-stdio") {
          delete c.command;
          delete c.args;
          delete c.envNames;
          delete c.encryptedEnv;
        }
        if (clean.kind !== "mcp-http") delete c.url;
        if (clean.designSystemId === undefined) delete c.designSystemId;
      }
      if (input.secret !== undefined) c.encryptedSecret = encryptedSecret;
      if (env !== undefined) {
        c.envNames = Object.keys(env);
        c.encryptedEnv = encryptedEnv;
      }
      // A different server invalidates its OAuth registration and tokens.
      if (existing && c.url !== existing.url) {
        c.encryptedOAuth = undefined;
        this.oauthState.set(id, {});
      }
    });

    const after = JSON.stringify(connectionFields(this.find(id)!));
    if (before !== after || input.secret !== undefined || input.env !== undefined) void this.manager.disconnect(id);
    return this.view(id);
  }

  async remove(id: string): Promise<void> {
    await this.manager.disconnect(id);
    this.deps.store.update((d) => {
      d.connectors = (d.connectors ?? []).filter((c) => c.id !== id);
    });
    this.deps.onChange({ id, deleted: true });
  }

  async connect(id: string): Promise<ConnectorView> {
    this.stored(id);
    await this.manager.connect(id);
    return this.view(id);
  }

  /** Forgets OAuth tokens and client registration, then disconnects. */
  async signOut(id: string): Promise<ConnectorView> {
    this.oauthState.set(id, {});
    this.deps.store.update((d) => {
      const c = d.connectors?.find((x) => x.id === id);
      if (c) c.encryptedOAuth = undefined;
    });
    await this.manager.disconnect(id);
    return this.view(id);
  }

  setTool(id: string, tool: string, enabled: boolean): ConnectorView {
    this.deps.store.update((d) => {
      const c = d.connectors?.find((x) => x.id === id);
      if (c) c.toolOverrides = { ...c.toolOverrides, [tool]: enabled };
    });
    const view = this.view(id);
    this.deps.onChange(view);
    return view;
  }

  /**
   * Tools for a build turn in an app built with `designSystemId`. Connectors
   * that fail to connect are skipped and reported as warnings.
   */
  async toolsetFor(designSystemId: string): Promise<{ toolset?: Toolset; connectors: string[]; warnings: string[] }> {
    const active = (this.deps.store.get().connectors ?? []).filter(
      (c) => c.enabled && (!c.designSystemId || c.designSystemId === designSystemId),
    );
    const warnings: string[] = [];
    const routes = new Map<string, { connectorId: string; tool: string }>();
    const specs: ToolSpec[] = [];
    const names: string[] = [];

    await Promise.all(
      active.map(async (c) => {
        try {
          await this.manager.ensure(c.id);
        } catch (err) {
          warnings.push(`${c.name} connector unavailable: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
        }
      }),
    );
    // Sorted so the tool list, which is part of the cached prompt prefix, is stable.
    for (const c of [...active].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))) {
      const view = this.view(c.id);
      if (view.state !== "connected") continue;
      const raw = this.manager.status(c.id).tools;
      const enabled = raw.filter((t) => view.tools.find((v) => v.name === t.name)?.enabled).sort((a, b) => a.name.localeCompare(b.name));
      if (enabled.length === 0) continue;
      names.push(c.name);
      for (const t of enabled) {
        const name = uniqueName(toolName(c.name, t.name), routes);
        routes.set(name, { connectorId: c.id, tool: t.name });
        specs.push({
          name,
          description: `[${c.name}] ${t.description}`.slice(0, 1024),
          inputSchema: normalizeSchema(t.inputSchema),
          label: `${c.name} · ${t.name}`,
        });
      }
    }
    if (specs.length === 0) return { connectors: [], warnings };
    return {
      connectors: names,
      warnings,
      toolset: {
        specs,
        call: (name, input, signal) => {
          const route = routes.get(name);
          if (!route) throw new Error(`Unknown tool: ${name}`);
          return this.manager.call(route.connectorId, route.tool, input, signal);
        },
      },
    };
  }

  // ------------------------------------------------------------ internals

  private view(id: string): ConnectorView {
    const c = this.stored(id);
    const status = this.manager.status(id);
    const { encryptedSecret, encryptedEnv, encryptedOAuth, ...config } = c;
    void encryptedEnv;
    void encryptedOAuth;
    return {
      ...config,
      hasSecret: Boolean(encryptedSecret || c.encryptedEnv),
      state: status.state,
      message: status.message,
      tools: status.tools.map((t) => ({
        name: t.name,
        description: t.description,
        readOnly: t.readOnly,
        enabled: c.toolOverrides[t.name] ?? defaultToolEnabled(t.readOnly),
      })),
    };
  }

  private async secrets(id: string): Promise<ConnectorSecrets> {
    const c = this.stored(id);
    return {
      token: c.encryptedSecret ? await this.deps.secrets.decrypt(c.encryptedSecret) : undefined,
      env: await this.decryptJson<Record<string, string>>(c.encryptedEnv),
    };
  }

  private async hydrateOAuth(id: string): Promise<void> {
    if (this.oauthState.has(id)) return;
    this.oauthState.set(id, (await this.decryptJson<OAuthState>(this.stored(id).encryptedOAuth)) ?? {});
  }

  private persistOAuth(id: string, state: OAuthState): void {
    this.oauthState.set(id, state);
    this.oauthPersist.set(
      id,
      Promise.resolve(this.deps.secrets.encrypt(JSON.stringify(state))).then((cipher) => {
        this.deps.store.update((d) => {
          const c = d.connectors?.find((x) => x.id === id);
          if (c) c.encryptedOAuth = cipher;
        });
      }),
    );
  }

  private async decryptJson<T>(cipher?: string): Promise<T | undefined> {
    if (!cipher) return undefined;
    try {
      return JSON.parse(await this.deps.secrets.decrypt(cipher)) as T;
    } catch {
      return undefined;
    }
  }

  private find(id: string): StoredConnector | undefined {
    return this.deps.store.get().connectors?.find((c) => c.id === id);
  }

  private stored(id: string): StoredConnector {
    const c = this.find(id);
    if (!c) throw new Error("Connector not found");
    return c;
  }

  private validate(input: ConnectorInput): Omit<ConnectorConfig, "id" | "hasSecret" | "toolOverrides" | "envNames"> {
    const name = String(input.name ?? "").trim();
    if (!name || name.length > 80) throw new Error("Give the connector a name of up to 80 characters.");
    if (!KINDS.includes(input.kind)) throw new Error("Unknown connector type.");
    if (!["none", "bearer", "oauth"].includes(input.auth)) throw new Error("Unknown auth type.");
    if (input.designSystemId && !this.deps.designSystemExists(input.designSystemId)) throw new Error("That design system no longer exists.");
    const base = {
      name,
      kind: input.kind,
      enabled: Boolean(input.enabled),
      designSystemId: input.designSystemId || undefined,
      auth: input.kind === "mcp-http" ? input.auth : input.kind === "figma-api" ? ("bearer" as const) : ("none" as const),
      presetId: input.presetId,
    };
    if (input.kind === "mcp-stdio") {
      const command = String(input.command ?? "").trim();
      if (!command) throw new Error("Enter the command that starts the server.");
      const args = (input.args ?? []).map(String);
      if (args.length > 64) throw new Error("Too many arguments.");
      if (input.env) {
        for (const key of Object.keys(input.env)) if (!ENV_NAME.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
      }
      return { ...base, command, args };
    }
    if (input.kind === "mcp-http") {
      let url: URL;
      try {
        url = new URL(String(input.url ?? "").trim());
      } catch {
        throw new Error("Enter the server's full URL.");
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The URL must use http or https.");
      if (url.username || url.password) throw new Error("Put credentials in the token field, not the URL.");
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (input.auth !== "none" && url.protocol !== "https:" && !loopback) {
        throw new Error("Tokens and sign-in are only sent over https, or over http to this computer.");
      }
      return { ...base, url: url.toString() };
    }
    return base;
  }
}

function connectionFields(c: StoredConnector) {
  return { kind: c.kind, command: c.command, args: c.args, url: c.url, auth: c.auth };
}

/** Provider-safe tool names: [A-Za-z0-9_-], at most 64 characters. */
export function toolName(connector: string, tool: string): string {
  const slug = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${slug(connector).slice(0, 24) || "connector"}__${slug(tool)}`.slice(0, 64);
}

function uniqueName(name: string, taken: Map<string, unknown>): string {
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name.slice(0, 60)}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Providers require an object schema at the top level. */
function normalizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema && schema.type === "object") return { properties: {}, ...schema };
  return { type: "object", properties: {} };
}
