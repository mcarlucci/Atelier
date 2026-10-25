import { useCallback, useEffect, useState } from "react";
import type { EffortLevel, ProviderSettings as ProviderState, ProviderUpdate, Settings } from "@shared/types";
import { DEFAULT_OLLAMA_CONTEXT, PROVIDERS, providerPreset, type ProviderId } from "@shared/providers";
import { api, errorMessage } from "../api";
import { modelLabel } from "../format";
import { Icon } from "../ui/icons";
import { Alert, Checkbox, Select, TextField, toast } from "../ui/slab";

const EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
/** Above this many models, the picker list gets a filter. */
const FILTER_AFTER = 12;

/** Picks the active provider and configures it: endpoint, key, model. */
export default function ProviderSettings({ settings, onSettings }: { settings: Settings; onSettings(s: Settings, note?: string): void }) {
  const configure = useCallback(
    (id: ProviderId, update: ProviderUpdate, note?: string) =>
      api
        .invoke("settings:configure-provider", id, update)
        .then((s) => onSettings(s, note))
        .catch((e) => toast(errorMessage(e), "danger")),
    [onSettings],
  );

  const active = settings.providers.find((p) => p.id === settings.provider)!;

  return (
    <>
      <div className="provider-grid" role="group" aria-label="Provider">
        {PROVIDERS.map((p) => {
          const state = settings.providers.find((x) => x.id === p.id)!;
          const selected = p.id === settings.provider;
          return (
            <button
              key={p.id}
              className="provider-card"
              aria-pressed={selected}
              onClick={() => !selected && void configure(p.id, { activate: true }, `Using ${p.label}.`)}
            >
              <span className="provider-card-head">
                <strong>{p.label}</strong>
                {p.local ? <span className="tag ok">Local · free</span> : p.id === "anthropic" ? <span className="tag accent">Recommended</span> : null}
                {selected && <Icon name="check" size={14} className="provider-check" />}
              </span>
              <span className="muted small">{p.blurb}</span>
              {!p.local && p.needsKey && <span className={`small ${state.hasApiKey ? "ok" : "muted"}`}>{state.hasApiKey ? "Key saved" : "Needs a key"}</span>}
            </button>
          );
        })}
      </div>
      <ProviderForm key={active.id} state={active} effort={settings.effort} configure={configure} onSettings={onSettings} />
      <PromptModels settings={settings} configure={configure} />
    </>
  );
}

function ProviderForm({
  state,
  effort,
  configure,
  onSettings,
}: {
  state: ProviderState;
  effort: EffortLevel;
  configure(id: ProviderId, update: ProviderUpdate, note?: string): Promise<void>;
  onSettings(s: Settings, note?: string): void;
}) {
  const preset = providerPreset(state.id);
  const [baseUrl, setBaseUrl] = useState(state.baseUrl);
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState("");
  const [context, setContext] = useState(String(state.contextLength ?? DEFAULT_OLLAMA_CONTEXT));

  const canQuery = state.hasApiKey || !preset.needsKey;
  const refresh = useCallback(() => {
    if (!canQuery) return;
    setLoading(true);
    setError(null);
    api
      .invoke("llm:models", state.id)
      .then((r) => {
        if (r.error) {
          setModels(null);
          setError(r.error);
        } else {
          setModels(r.models);
        }
      })
      .catch((e) => {
        setModels(null);
        setError(errorMessage(e));
      })
      .finally(() => setLoading(false));
    // Refetch when the base URL changes too.
  }, [state.id, canQuery, state.baseUrl]);

  useEffect(refresh, [refresh]);

  const options = [...new Set([...(models ?? []), ...(state.model ? [state.model] : [])])].map((m) => ({ value: m, label: modelLabel(m) }));

  return (
    <div className="provider-form form">
      <div className="row">
        <h2 className="grow">{preset.label}</h2>
        {loading ? (
          <span className="muted small row">
            <span className="spinner" aria-hidden="true" /> Connecting…
          </span>
        ) : models ? (
          <span className="tag ok">
            <Icon name="check" size={12} /> Connected · {models.length} models
          </span>
        ) : null}
        {preset.setupUrl && (
          <a className="small" href={preset.setupUrl} target="_blank" rel="noreferrer">
            {preset.needsKey ? "Get a key" : "Download"} <Icon name="external" size={12} />
          </a>
        )}
      </div>

      {preset.kind !== "anthropic" && (
        <TextField
          label="Base URL"
          type="url"
          value={baseUrl}
          onValue={setBaseUrl}
          placeholder={preset.defaultBaseUrl}
          description={preset.local ? "Requests stay on this computer." : "Your prompts and app code are sent here."}
          onCommit={(v) => v.trim() !== state.baseUrl && void configure(state.id, { baseUrl: v }, "Base URL saved.")}
        />
      )}

      {(preset.needsKey || preset.id === "custom") && (
        <div className="row">
          <TextField
            className="grow"
            type="password"
            label={preset.needsKey ? "API key" : "API key (optional)"}
            placeholder={state.hasApiKey ? "•••••••• saved" : preset.id === "anthropic" ? "sk-ant-…" : "Paste a key"}
            value={key}
            onValue={setKey}
            description="Encrypted with the OS keychain. It is only sent to this provider."
          />
          <button
            className="primary"
            disabled={!key.trim()}
            onClick={() => void configure(state.id, { apiKey: key }, "API key saved.").then(() => setKey(""))}
          >
            Save key
          </button>
          {state.hasApiKey && <button onClick={() => void configure(state.id, { apiKey: null }, "API key removed.")}>Remove</button>}
        </div>
      )}

      {error && (
        <Alert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div className="row end">
        <Select
          className="grow"
          label="Model"
          placeholder={canQuery ? (loading ? "Loading models…" : "Choose a model") : "Save a key to list models"}
          value={state.model}
          options={options}
          onValue={(model) => model !== state.model && void configure(state.id, { model }, `Model set to ${modelLabel(model)}.`)}
        />
        <button onClick={refresh} disabled={!canQuery || loading} aria-label="Refresh models" title="Refresh models">
          <Icon name="refresh" size={14} />
        </button>
      </div>
      <TextField
        label="Or enter a model id"
        placeholder={`e.g. ${preset.modelPlaceholder}`}
        value={customModel}
        onValue={setCustomModel}
        onCommit={(v) => {
          if (!v.trim() || v.trim() === state.model) return;
          void configure(state.id, { model: v.trim() }, `Model set to ${v.trim()}.`).then(() => setCustomModel(""));
        }}
      />
      {preset.id === "ollama" && models?.length === 0 && (
        <Alert tone="info">
          Ollama is running but has no models. Install one in a terminal, for example <code>ollama pull {preset.modelPlaceholder}</code>, then refresh.
        </Alert>
      )}

      {preset.kind === "ollama" && (
        <TextField
          label="Context length (tokens)"
          value={context}
          onValue={setContext}
          description="Atelier sends the design system catalog and the whole app each turn, so small windows cut the prompt off. Larger windows need more memory."
          onCommit={(v) => {
            const n = Number(v);
            if (n !== state.contextLength) void configure(state.id, { contextLength: n }, "Context length saved.");
          }}
        />
      )}

      {preset.kind === "anthropic" ? (
        <>
          <Select
            label="Effort"
            value={effort}
            options={EFFORTS.map((e) => ({ value: e, label: e }))}
            onValue={(value) =>
              api
                .invoke("settings:set", { effort: value as EffortLevel })
                .then((s) => onSettings(s, "Effort updated."))
                .catch((e) => toast(errorMessage(e), "danger"))
            }
          />
          <p className="muted small">Higher effort spends more tokens per turn and usually produces more complete screens.</p>
        </>
      ) : (
        <p className="muted small">
          Open models vary a lot in how well they follow Atelier's file and design system rules. Larger coding models (30B and up) work best.
          The design system check after each turn catches most mistakes.
        </p>
      )}
    </div>
  );
}

type ProviderModels = { state: "loading" } | { state: "ok"; models: string[] } | { state: "error" };

/**
 * Which models the prompt's model picker offers, across every connected
 * provider. The active provider offers all its models until some are chosen;
 * other providers offer none until some are chosen.
 */
function PromptModels({ settings, configure }: { settings: Settings; configure(id: ProviderId, update: ProviderUpdate, note?: string): Promise<void> }) {
  const [listed, setListed] = useState<Partial<Record<ProviderId, ProviderModels>>>({});
  const [filter, setFilter] = useState("");
  const candidates = settings.providers.filter((p) => p.hasApiKey || !providerPreset(p.id).needsKey);
  // Re-list when a key or base URL changes.
  const fingerprint = candidates.map((p) => `${p.id}|${p.hasApiKey}|${p.baseUrl}`).join(",");

  useEffect(() => {
    let cancelled = false;
    for (const p of candidates) {
      setListed((l) => ({ ...l, [p.id]: { state: "loading" } }));
      api.invoke("llm:models", p.id).then(
        (r) => !cancelled && setListed((l) => ({ ...l, [p.id]: r.error ? { state: "error" } : { state: "ok", models: r.models } })),
        () => !cancelled && setListed((l) => ({ ...l, [p.id]: { state: "error" } })),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [fingerprint]);

  const q = filter.trim().toLowerCase();
  const groups = candidates
    .map((p) => {
      const result = listed[p.id];
      const available = result?.state === "ok" ? result.models : [];
      // Saved choices stay visible (and can be unticked) while a provider is unreachable.
      const all = [...new Set([...available, ...(p.shownModels ?? [])])];
      const active = p.id === settings.provider;
      const shown = new Set(p.shownModels ?? (active ? available : []));
      return { p, active, all, shown, loading: result?.state === "loading" };
    })
    .filter((g) => g.all.length || g.loading);
  const total = groups.reduce((n, g) => n + g.all.length, 0);
  const picked = groups.reduce((n, g) => n + g.shown.size, 0);
  const unreachable = candidates.filter((p) => listed[p.id]?.state === "error" && !p.shownModels?.length).map((p) => providerPreset(p.id).label);

  if (!groups.length) return null;
  return (
    <fieldset className="shown-models">
      <legend>Models in the prompt</legend>
      <p className="muted small">
        {picked} of {total} models from {groups.length} {groups.length === 1 ? "provider" : "providers"} show in the model menu under the prompt. Picking a
        model from another provider there switches to that provider.
        {unreachable.length > 0 && ` Not reachable right now: ${unreachable.join(", ")}.`}
      </p>
      {total > FILTER_AFTER && <TextField type="search" label="Filter models" hideLabel placeholder="Filter models" value={filter} onValue={setFilter} />}
      <div className="shown-models-list">
        {groups.map(({ p, active, all, shown, loading }) => {
          const label = providerPreset(p.id).label;
          const visible = q ? all.filter((m) => m.toLowerCase().includes(q) || modelLabel(m).toLowerCase().includes(q)) : all;
          const save = (next: string[]) => void configure(p.id, { shownModels: next });
          return (
            <section key={p.id} className="shown-models-group" aria-label={label}>
              <div className="row">
                <strong className="grow">
                  {label}
                  {active && <span className="tag accent">Active</span>}
                </strong>
                {loading && <span className="spinner" aria-label="Loading models" />}
                <button className="sm ghost" disabled={shown.size === all.length} onClick={() => (active ? void configure(p.id, { shownModels: null }) : save(all))}>
                  All
                </button>
                <button className="sm ghost" disabled={shown.size === 0} onClick={() => save([])}>
                  None
                </button>
              </div>
              {visible.map((m) => (
                <Checkbox
                  key={m}
                  label={modelLabel(m)}
                  checked={shown.has(m)}
                  onChecked={(on) => save(on ? all.filter((x) => shown.has(x) || x === m) : [...shown].filter((x) => x !== m))}
                />
              ))}
              {q && !visible.length && <p className="muted small">No {label} models match “{filter}”.</p>}
            </section>
          );
        })}
      </div>
    </fieldset>
  );
}
