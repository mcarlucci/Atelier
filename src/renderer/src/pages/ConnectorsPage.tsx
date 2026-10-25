import { useEffect, useMemo, useState } from "react";
import type { DesignSystem } from "@shared/types";
import { CONNECTOR_PRESETS, type ConnectorInput, type ConnectorPreset, type ConnectorView } from "@shared/connectors";
import { api, errorMessage } from "../api";
import type { Route } from "../App";
import { Icon, type IconName } from "../ui/icons";
import { Alert, Checkbox, Select, TextArea, TextField, ToggleGroup, toast, useConfirm } from "../ui/slab";

const ALL = "all";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const PRESET_ICONS: Record<string, IconName> = { "figma-desktop": "figma", "figma-api": "figma", storybook: "book", local: "terminal", remote: "globe" };

function iconFor(c: { presetId?: string; kind: string }): IconName {
  return PRESET_ICONS[c.presetId ?? ""] ?? (c.kind === "mcp-stdio" ? "terminal" : c.kind === "figma-api" ? "figma" : "globe");
}

export default function ConnectorsPage({ selectedId, navigate }: { selectedId?: string; navigate(r: Route): void }) {
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [systems, setSystems] = useState<DesignSystem[]>([]);
  const [draft, setDraft] = useState<ConnectorPreset | null>(null);

  useEffect(() => {
    void api.invoke("connectors:list").then(setConnectors);
    void api.invoke("ds:list").then(setSystems);
    return api.on("connectors:status", (e) =>
      setConnectors((list) =>
        "deleted" in e ? list.filter((c) => c.id !== e.id) : list.some((c) => c.id === e.id) ? list.map((c) => (c.id === e.id ? e : c)) : [...list, e],
      ),
    );
  }, []);

  const selected = connectors.find((c) => c.id === selectedId);
  const open = (id?: string) => {
    setDraft(null);
    navigate({ page: "connectors", selectedId: id });
  };

  return (
    <div className="split">
      <div className="list-pane">
        <div className="list-head">
          <h1>Connectors</h1>
          <button className="sm" onClick={() => open()}>
            <Icon name="plus" size={14} />
            Add
          </button>
        </div>
        {connectors.map((c) => (
          <button key={c.id} className="list-item" aria-current={c.id === selectedId ? "true" : undefined} onClick={() => open(c.id)}>
            <span className="row">
              <span className="ds-mark">
                <Icon name={iconFor(c)} size={14} />
              </span>
              <strong className="truncate grow">{c.name}</strong>
              <StateDot view={c} />
            </span>
            <span className="muted small">
              {!c.enabled ? "Off" : c.state === "connected" ? plural(c.tools.filter((t) => t.enabled).length, "tool") : stateLabel(c)} ·{" "}
              {c.designSystemId ? (systems.find((s) => s.id === c.designSystemId)?.name ?? "Missing design system") : "All apps"}
            </span>
          </button>
        ))}
        {connectors.length === 0 && <p className="muted small app-list-empty">No connectors yet.</p>}
      </div>
      <div className="detail-pane">
        {selected ? (
          <ConnectorForm
            key={selected.id}
            view={selected}
            systems={systems}
            onSaved={(v) => setConnectors((list) => list.map((c) => (c.id === v.id ? v : c)))}
            onDeleted={() => open()}
          />
        ) : draft ? (
          <ConnectorForm
            key={draft.id}
            preset={draft}
            systems={systems}
            onCancel={() => setDraft(null)}
            onSaved={(v) => {
              setConnectors((list) => [...list.filter((c) => c.id !== v.id), v]);
              open(v.id);
              // Connect right away, so the tools appear.
              void api.invoke("connectors:connect", v.id).catch((e) => toast(errorMessage(e), "danger"));
            }}
          />
        ) : (
          <Gallery onPick={setDraft} />
        )}
      </div>
    </div>
  );
}

function Gallery({ onPick }: { onPick(p: ConnectorPreset): void }) {
  return (
    <div className="page-scroll">
      <div>
        <h1>Add a connector</h1>
        <p className="muted">
          Connectors give the AI read access to your design system's documentation and your design tools while it builds. It decides when to use
          them, for example reading a Figma frame you link to, or looking up how a component should be used. Tools that change data stay off
          unless you turn them on.
        </p>
      </div>
      <div className="preset-grid">
        {CONNECTOR_PRESETS.map((p) => (
          <button key={p.id} className="provider-card" onClick={() => onPick(p)}>
            <span className="provider-card-head">
              <span className="ds-mark">
                <Icon name={PRESET_ICONS[p.id] ?? "plug"} size={14} />
              </span>
              <strong>{p.label}</strong>
              <span className="tag">{p.input.kind === "mcp-stdio" ? "Local" : p.input.kind === "figma-api" ? "Built in" : p.input.url?.startsWith("http://") ? "Local" : "Remote"}</span>
            </span>
            <span className="muted small">{p.blurb}</span>
          </button>
        ))}
      </div>
      <section className="card">
        <h2>Bring your design system's own MCP server</h2>
        <p className="muted small">
          Any server that speaks the Model Context Protocol works: one that serves your component docs, usage guidelines, tokens or code
          examples. Start it as a local command or point at its URL. Limit it to apps built with one design system under <em>Use with</em>.
        </p>
      </section>
    </div>
  );
}

function ConnectorForm({
  view,
  preset,
  systems,
  onSaved,
  onDeleted,
  onCancel,
}: {
  view?: ConnectorView;
  preset?: ConnectorPreset;
  systems: DesignSystem[];
  onSaved(v: ConnectorView): void;
  onDeleted?(): void;
  onCancel?(): void;
}) {
  const initial: ConnectorInput = view ?? { ...preset!.input, enabled: true };
  const presetInfo = CONNECTOR_PRESETS.find((p) => p.id === (view?.presetId ?? preset?.id));
  const [name, setName] = useState(initial.name);
  const [enabled, setEnabled] = useState(initial.enabled);
  // Slab treats an empty value as "nothing selected", so "all" stands for no design system.
  const [dsId, setDsId] = useState(initial.designSystemId ?? ALL);
  const [command, setCommand] = useState(initial.command ?? "");
  const [args, setArgs] = useState(formatArgs(initial.args ?? []));
  const [env, setEnv] = useState("");
  const [url, setUrl] = useState(initial.url ?? "");
  const [auth, setAuth] = useState(initial.auth);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmNode, confirm] = useConfirm();
  const kind = initial.kind;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const input: ConnectorInput = {
        id: view?.id,
        name,
        kind,
        enabled,
        designSystemId: dsId === ALL ? undefined : dsId,
        auth,
        presetId: initial.presetId,
        ...(kind === "mcp-stdio" ? { command, args: parseArgs(args), ...(env.trim() ? { env: parseEnv(env) } : {}) } : {}),
        ...(kind === "mcp-http" ? { url } : {}),
        ...(secret.trim() ? { secret } : {}),
      };
      const saved = await api.invoke("connectors:save", input);
      setSecret("");
      setEnv("");
      onSaved(saved);
      if (view) toast("Connector saved.", "success");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const needsToken = kind === "figma-api" || (kind === "mcp-http" && auth === "bearer");
  const tokenSaved = Boolean(view?.hasSecret) && kind !== "mcp-stdio";

  return (
    <div className="page-scroll">
      {confirmNode}
      <div className="list-head">
        <div className="row">
          <span className="hero-empty-icon">
            <Icon name={iconFor(initial)} size={20} />
          </span>
          <div>
            <h1>{view ? view.name : `New ${presetInfo?.label ?? "connector"}`}</h1>
            <p className="muted small">
              {kind === "mcp-stdio" ? "Local MCP server (stdio)" : kind === "mcp-http" ? "MCP server over HTTP" : "Figma REST API"}
            </p>
          </div>
        </div>
        {view && (
          <div className="row">
            <StatusBadge view={view} />
            <button disabled={busy || view.state === "connecting"} onClick={() => void api.invoke("connectors:connect", view.id).catch((e) => toast(errorMessage(e), "danger"))}>
              <Icon name="refresh" size={14} />
              {view.state === "connected" ? "Reconnect" : "Connect"}
            </button>
          </div>
        )}
      </div>

      {presetInfo?.setup && !view && <Alert tone="info">{presetInfo.setup}</Alert>}
      {view?.state === "error" && view.message && (
        <Alert tone="danger">
          <pre className="plain">{view.message}</pre>
        </Alert>
      )}
      {view?.state === "needs-auth" && <Alert tone="warning">{view.message ?? "Finish signing in in your browser."}</Alert>}
      {error && (
        <Alert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <section className="card form">
        <div className="row start">
          <TextField className="grow" label="Name" value={name} onValue={setName} />
          <Select
            label="Use with"
            value={dsId}
            onValue={setDsId}
            options={[{ value: ALL, label: "All design systems" }, ...systems.map((s) => ({ value: s.id, label: s.name }))]}
          />
        </div>

        {kind === "mcp-stdio" && (
          <>
            <Alert tone="warning">Atelier runs this command on your computer with your user's permissions. Only add servers you trust.</Alert>
            <TextField label="Command" placeholder="npx" value={command} onValue={setCommand} />
            <TextField label="Arguments" placeholder="-y @your-org/design-system-mcp" value={args} onValue={setArgs} description="Separated by spaces. Quote an argument that contains spaces." />
            <TextArea
              label="Environment variables (optional)"
              rows={3}
              placeholder={view?.envNames?.length ? `Saved: ${view.envNames.join(", ")}. Enter new values to replace them.` : "API_KEY=…\nDOCS_URL=…"}
              value={env}
              onValue={setEnv}
              description="One KEY=value per line. Encrypted with the OS keychain."
            />
          </>
        )}

        {kind === "mcp-http" && (
          <>
            <TextField label="Server URL" type="url" placeholder="https://mcp.example.com/mcp" value={url} onValue={setUrl} />
            <ToggleGroup
              label="Authentication"
              value={auth}
              onValue={(v) => setAuth(v as typeof auth)}
              options={[
                { value: "none", label: "None" },
                { value: "bearer", label: "Bearer token" },
                { value: "oauth", label: "OAuth sign-in" },
              ]}
            />
            {auth === "oauth" && (
              <p className="muted small">Connecting opens the server's sign-in page in your browser. Tokens are encrypted with the OS keychain.</p>
            )}
          </>
        )}

        {needsToken && (
          <TextField
            label={kind === "figma-api" ? "Personal access token" : "Bearer token"}
            type="password"
            placeholder={tokenSaved ? "•••••••• saved. Enter a new one to replace it." : kind === "figma-api" ? "figd_…" : "Token"}
            value={secret}
            onValue={setSecret}
            description="Encrypted with the OS keychain and only sent to this connector."
          />
        )}

        <Checkbox label="Enabled" checked={enabled} onChecked={setEnabled} />

        <div className="row">
          <button className="primary" disabled={busy || !name.trim()} onClick={save}>
            {busy ? "Saving…" : view ? "Save" : "Add connector"}
          </button>
          {onCancel && <button onClick={onCancel}>Cancel</button>}
          <div className="spacer" />
          {view?.auth === "oauth" && (
            <button onClick={() => void api.invoke("connectors:sign-out", view.id).then(onSaved, (e) => toast(errorMessage(e), "danger"))}>Sign out</button>
          )}
          {view && (
            <button
              className="danger"
              onClick={async () => {
                const ok = await confirm({
                  title: `Remove ${view.name}?`,
                  body: "The connector, its saved tokens and its tool settings are removed. Apps stop using it.",
                  confirmLabel: "Remove",
                  danger: true,
                });
                if (ok) await api.invoke("connectors:delete", view.id).then(onDeleted, (e) => toast(errorMessage(e), "danger"));
              }}
            >
              Remove
            </button>
          )}
        </div>
      </section>

      {view && <ToolList view={view} onChange={onSaved} />}
    </div>
  );
}

function ToolList({ view, onChange }: { view: ConnectorView; onChange(v: ConnectorView): void }) {
  const [filter, setFilter] = useState("");
  const tools = useMemo(() => view.tools.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase())), [view.tools, filter]);
  if (view.state !== "connected") return null;
  return (
    <section className="card form">
      <div className="row">
        <h2 className="grow">Tools</h2>
        <span className="muted small">
          {view.tools.filter((t) => t.enabled).length} of {view.tools.length} on
        </span>
      </div>
      {view.tools.length > 8 && <TextField label="Filter tools" hideLabel placeholder="Filter tools" value={filter} onValue={setFilter} />}
      {view.tools.length === 0 && <p className="muted small">This server offers no tools.</p>}
      <div className="tool-list">
        {tools.map((t) => (
          <div key={t.name} className="tool-row">
            <Checkbox
              label={`Use ${t.name}`}
              hideLabel
              checked={t.enabled}
              onChecked={(enabled) => void api.invoke("connectors:set-tool", view.id, t.name, enabled).then(onChange, (e) => toast(errorMessage(e), "danger"))}
            />
            <div className="grow">
              <div className="row">
                <code>{t.name}</code>
                {t.readOnly === true && <span className="tag ok">Read-only</span>}
                {t.readOnly === false && <span className="tag warn">Can change data</span>}
              </div>
              {t.description && <p className="muted small tool-desc">{t.description}</p>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function stateLabel(v: ConnectorView): string {
  return { idle: "Not connected", connecting: "Connecting…", "needs-auth": "Waiting for sign-in", connected: "Connected", error: "Error" }[v.state];
}

function StateDot({ view }: { view: ConnectorView }) {
  return <span className={`state-dot ${view.enabled ? view.state : "off"}`} title={view.enabled ? stateLabel(view) : "Off"} />;
}

function StatusBadge({ view }: { view: ConnectorView }) {
  const cls = { idle: "stopped", connecting: "starting", "needs-auth": "starting", connected: "running", error: "error" }[view.state];
  return (
    <span className={`badge ${cls}`}>
      <span className="badge-dot" />
      {stateLabel(view)}
      {view.state === "connected" && view.message ? ` · ${view.message}` : ""}
    </span>
  );
}

/** Splits on spaces, keeping quoted arguments together. */
export function parseArgs(s: string): string[] {
  return [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

function formatArgs(args: string[]): string {
  return args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
}

function parseEnv(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of s.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) throw new Error(`Expected KEY=value, got “${t}”.`);
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}
