import { useEffect, useMemo, useState } from "react";
import type { ComponentInfo, DesignSystem, FrameworkId } from "@shared/types";
import { api, errorMessage } from "../api";
import type { Route } from "../App";
import { defaultTemplateFor, FRAMEWORK_LABELS, FRAMEWORK_PACKAGE, isCompatible, type TemplateInfo } from "@shared/templates";
import { Icon } from "../ui/icons";
import { Alert, Checkbox, Progress, Select, TabPanel, Tabs, TextArea, TextField, ToggleGroup, toast, useConfirm } from "../ui/slab";

export default function DesignSystemsPage({ selectedId, navigate }: { selectedId?: string; navigate(r: Route): void }) {
  const [systems, setSystems] = useState<DesignSystem[]>([]);
  const refresh = () => api.invoke("ds:list").then(setSystems);
  useEffect(() => {
    void refresh();
  }, []);

  const selected = systems.find((s) => s.id === selectedId);
  return (
    <div className="split">
      <div className="list-pane">
        <div className="list-head">
          <h1>Design systems</h1>
          <button className="sm" onClick={() => navigate({ page: "design-systems" })}>
            <Icon name="plus" size={14} />
            Import
          </button>
        </div>
        {systems.map((s) => (
          <button
            key={s.id}
            className="list-item"
            aria-current={s.id === selectedId ? "true" : undefined}
            onClick={() => navigate({ page: "design-systems", selectedId: s.id })}
          >
            <span className="row">
              <span className="ds-mark">
                <Icon name="palette" size={14} />
              </span>
              <strong className="truncate">{s.name}</strong>
            </span>
            <span className="muted small">
              {s.framework} · v{s.version} · {s.components.filter((c) => c.enabled).length} components
            </span>
          </button>
        ))}
      </div>
      <div className="detail-pane">
        {selected ? (
          <DesignSystemDetail
            key={selected.id}
            ds={selected}
            onChange={(ds) => setSystems((list) => list.map((x) => (x.id === ds.id ? ds : x)))}
            onDeleted={() => {
              void refresh();
              navigate({ page: "design-systems" });
            }}
          />
        ) : (
          <ImportForm
            onImported={(ds) => {
              void refresh();
              navigate({ page: "design-systems", selectedId: ds.id });
            }}
          />
        )}
      </div>
    </div>
  );
}

/** One-click starting points, one per publishing style Atelier handles. */
const POPULAR: { spec: string; framework: FrameworkId }[] = [
  { spec: "@mui/material", framework: "react" },
  { spec: "@mantine/core", framework: "react" },
  { spec: "@radix-ui/themes", framework: "react" },
  { spec: "vuetify", framework: "vue" },
  { spec: "primevue", framework: "vue" },
  { spec: "element-plus", framework: "vue" },
  { spec: "primeng", framework: "angular" },
  { spec: "@angular/material", framework: "angular" },
];

/** The latest import step reported by the main process while `active`. */
function useImportProgress(active: boolean): string {
  const [step, setStep] = useState("");
  useEffect(() => {
    if (!active) return;
    setStep("");
    return api.on("ds:import-progress", ({ line }) => {
      const last = line.split("\n").map((l) => l.trim()).filter(Boolean).pop();
      if (last) setStep(last);
    });
  }, [active]);
  return step;
}

function ImportForm({ onImported }: { onImported(ds: DesignSystem): void }) {
  const [kind, setKind] = useState<"npm" | "local">("npm");
  const [spec, setSpec] = useState("");
  const [registry, setRegistry] = useState("");
  const [token, setToken] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [framework, setFramework] = useState<FrameworkId | "auto">("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = useImportProgress(busy);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const ds = await api.invoke("ds:import", {
        source: kind === "npm" ? { kind, spec: spec.trim(), registry: registry.trim() || undefined } : { kind, path: localPath },
        authToken: kind === "npm" && token.trim() ? token.trim() : undefined,
        framework: framework === "auto" ? undefined : framework,
      });
      onImported(ds);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-scroll">
      <h1>Import a design system</h1>
      <p className="muted">
        Enter the npm package of any React, Vue or Angular component library. Atelier finds its components, stylesheet,
        theme and framework for you, and the AI builds screens only from them.
      </p>
      <section className="card form">
        <ToggleGroup
          label="Source"
          value={kind}
          onValue={(v) => setKind(v as "npm" | "local")}
          options={[
            { value: "npm", label: "npm package" },
            { value: "local", label: "Local folder" },
          ]}
        />
        {kind === "npm" ? (
          <>
            <TextField label="Package" placeholder="@acme/design-system or vuetify@^3" value={spec} onValue={setSpec} />
            <div className="row wrap" role="group" aria-label="Popular libraries">
              <span className="muted small">Try:</span>
              {POPULAR.map((p) => (
                <button key={p.spec} className="chip-btn" disabled={busy} onClick={() => setSpec(p.spec)} title={FRAMEWORK_LABELS[p.framework]}>
                  {p.spec}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="row end">
            <TextField
              className="grow"
              label="Built package folder (contains package.json and .d.ts files)"
              placeholder="/path/to/design-system/packages/ui"
              value={localPath}
              onValue={setLocalPath}
            />
            <button onClick={() => api.invoke("ds:select-folder").then((p) => p && setLocalPath(p))}>Browse…</button>
          </div>
        )}
        <details className="advanced">
          <summary>{kind === "npm" ? "Private registry and framework" : "Framework"}</summary>
          <div className="form">
            {kind === "npm" && (
              <>
                <TextField label="Private registry URL" type="url" placeholder="https://npm.acme.internal/" value={registry} onValue={setRegistry} />
                <TextField
                  label="Registry token"
                  type="password"
                  value={token}
                  onValue={setToken}
                  description="Encrypted with the OS keychain and passed to npm through the environment."
                />
              </>
            )}
            <Select
              label="Framework"
              value={framework}
              onValue={(v) => setFramework(v as FrameworkId | "auto")}
              options={[
                { value: "auto", label: "Detect automatically" },
                { value: "react", label: "React" },
                { value: "vue", label: "Vue" },
                { value: "angular", label: "Angular" },
              ]}
            />
          </div>
        </details>
        <div>
          <button className="primary" disabled={busy || (kind === "npm" ? !spec.trim() : !localPath)} onClick={submit}>
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
        {busy && (
          <>
            <Progress label="Importing" />
            <p className="muted small truncate">{step || "Starting…"}</p>
          </>
        )}
        {error && (
          <Alert tone="danger">
            <pre className="plain">{error}</pre>
          </Alert>
        )}
      </section>
      <details className="card advanced">
        <summary>Optional: ship a manifest with your package</summary>
        <p className="muted">
          Add <code>atelier.manifest.json</code> to the package root to supply guidelines, setup, tokens, and per-component
          descriptions and examples. It is merged on every import.
        </p>
        <pre className="code small">{`{
  "guidelines": "One primary Button per view. Use Stack for vertical rhythm.",
  "setup": { "globalCss": ["@acme/ui/dist/styles.css"],
             "provider": { "importName": "AcmeProvider", "importPath": "@acme/ui" } },
  "components": {
    "Button": { "examples": ["<Button variant=\\"primary\\">Save</Button>"] },
    "LegacyTable": { "enabled": false }
  }
}`}</pre>
      </details>
    </div>
  );
}

function DesignSystemDetail({
  ds,
  onChange,
  onDeleted,
}: {
  ds: DesignSystem;
  onChange(ds: DesignSystem): void;
  onDeleted(): void;
}) {
  const [tab, setTab] = useState("components");
  const [confirmNode, confirm] = useConfirm();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState("");
  const [guidelines, setGuidelines] = useState(ds.guidelines);
  const step = useImportProgress(busy);
  const [setupDraft, setSetupDraft] = useState(() => ({
    css: ds.setup.globalCss.join("\n"),
    providerName: ds.setup.provider?.importName ?? "",
    providerPath: ds.setup.provider?.importPath ?? ds.packageName,
    providerProps: ds.setup.provider?.props ?? "",
    extraDeps: JSON.stringify(ds.setup.extraDependencies, null, 2),
    pluginName: ds.setup.vuePlugin?.importName ?? "",
    pluginPath: ds.setup.vuePlugin?.importPath ?? ds.packageName,
    pluginOptions: ds.setup.vuePlugin?.options ?? "",
    pluginFactory: ds.setup.vuePlugin?.factory ?? false,
    modules: (ds.setup.angularModules ?? []).map((m) => `${m.importName} from ${m.importPath}`).join("\n"),
  }));

  useEffect(() => {
    if (tab === "prompt") void api.invoke("ds:preview-rules", ds.id).then(setRules);
  }, [tab, ds]);

  const run = async (fn: () => Promise<DesignSystem | void>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (result) {
        onChange(result);
        toast("Saved.", "success");
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const updateComponent = (name: string, patch: Partial<ComponentInfo>) =>
    run(() =>
      api.invoke("ds:update", ds.id, {
        components: ds.components.map((c) => (c.name === name ? { ...c, ...patch } : c)),
      }),
    );

  const visible = useMemo(
    () => ds.components.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase())),
    [ds.components, filter],
  );

  return (
    <div className="page-scroll">
      <div className="list-head">
        <div>
          <h1>{ds.name}</h1>
          <p className="muted">
            {ds.packageName}@{ds.version} · {ds.framework} · imported {new Date(ds.importedAt).toLocaleString()}
          </p>
        </div>
        <div className="row">
          <button disabled={busy} onClick={() => run(() => api.invoke("ds:reimport", ds.id))}>
            {busy ? "Working…" : "Re-import"}
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={async () => {
              const ok = await confirm({
                title: `Delete ${ds.name}?`,
                body: "The catalog, setup and guidelines are removed. Apps built with it must be deleted first.",
                confirmLabel: "Delete",
                danger: true,
              });
              if (ok) await run(() => api.invoke("ds:delete", ds.id).then(onDeleted));
            }}
          >
            Delete
          </button>
        </div>
      </div>
      {confirmNode}
      {busy && step && <p className="muted small truncate">{step}</p>}
      {ds.components.length === 0 && (
        <Alert tone="danger">No components were found when this was imported. Re-import to read the package again.</Alert>
      )}
      {ds.warnings.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}
      {error && (
        <Alert tone="danger" onDismiss={() => setError(null)}>
          <pre className="plain">{error}</pre>
        </Alert>
      )}

      <Tabs
        label="Design system sections"
        value={tab}
        onValue={setTab}
        tabs={[
          { id: "components", label: "Components" },
          { id: "setup", label: "Setup" },
          { id: "templates", label: "Templates" },
          { id: "guidelines", label: "Guidelines" },
          { id: "prompt", label: "AI rules preview" },
        ]}
      >
        <TabPanel name="components" className="panel-stack">
          <TextField label="Filter components" hideLabel placeholder={`Filter ${ds.components.length} components`} value={filter} onValue={setFilter} />
          <table className="table">
            <thead>
              <tr>
                <th>Use</th>
                <th>Component</th>
                <th>Props</th>
                <th>Description (sent to the AI)</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.name} className={c.enabled ? "" : "disabled"}>
                  <td>
                    <Checkbox label={`Use ${c.name}`} hideLabel checked={c.enabled} onChecked={(enabled) => updateComponent(c.name, { enabled })} />
                  </td>
                  <td>
                    <code>{c.selector ? `<${c.selector}>` : c.name}</code>
                    <div className="muted small">{c.importPath}</div>
                    {c.extendsNative && c.extendsNative !== "element" && <div className="muted small">wraps &lt;{c.extendsNative}&gt;</div>}
                  </td>
                  <td className="small">
                    {c.props.slice(0, 8).map((p) => (
                      <div key={p.name} title={p.type}>
                        {p.name}
                        {p.required ? "*" : ""}
                      </div>
                    ))}
                    {c.props.length > 8 && <div className="muted">+{c.props.length - 8} more</div>}
                  </td>
                  <td>
                    <DescriptionField component={c} onSave={(description) => updateComponent(c.name, { description })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TabPanel>

        <TabPanel name="setup">
        <section className="card form">
          <p className="muted">Generated into each app's design system setup file. Saving updates existing apps too.</p>
          <TextArea label="Global stylesheets (one per line)" rows={3} value={setupDraft.css} onValue={(css) => setSetupDraft({ ...setupDraft, css })} />
          <div className="row start">
            <TextField className="grow" label="Provider component" placeholder="ThemeProvider" value={setupDraft.providerName} onValue={(providerName) => setSetupDraft({ ...setupDraft, providerName })} />
            <TextField className="grow" label="Provider import path" value={setupDraft.providerPath} onValue={(providerPath) => setSetupDraft({ ...setupDraft, providerPath })} />
            <TextField className="grow" label="Provider props" placeholder='appearance="light"' value={setupDraft.providerProps} onValue={(providerProps) => setSetupDraft({ ...setupDraft, providerProps })} />
          </div>
          {ds.framework === "vue" && (
            <>
              <div className="row start">
                <TextField className="grow" label="Vue plugin" placeholder="PrimeVue or createVuetify" value={setupDraft.pluginName} onValue={(pluginName) => setSetupDraft({ ...setupDraft, pluginName })} />
                <TextField className="grow" label="Plugin import path" value={setupDraft.pluginPath} onValue={(pluginPath) => setSetupDraft({ ...setupDraft, pluginPath })} />
                <TextField className="grow" label="Plugin options (JavaScript)" placeholder="{ ripple: true }" value={setupDraft.pluginOptions} onValue={(pluginOptions) => setSetupDraft({ ...setupDraft, pluginOptions })} />
              </div>
              <Checkbox
                label="The plugin is a factory: call it with the options, as in app.use(createVuetify(options))"
                checked={setupDraft.pluginFactory}
                onChecked={(pluginFactory) => setSetupDraft({ ...setupDraft, pluginFactory })}
              />
            </>
          )}
          {ds.framework === "angular" && (
            <TextArea
              label="Root NgModules (one per line: Name from import/path)"
              rows={3}
              placeholder={"AcmeRootModule from @acme/ui\nAcmeIconsModule from @acme/ui/icons"}
              value={setupDraft.modules}
              onValue={(modules) => setSetupDraft({ ...setupDraft, modules })}
              description="Their providers are added to the app config with importProvidersFrom()."
            />
          )}
          <TextArea label="Extra dependencies (JSON: name to version)" rows={4} value={setupDraft.extraDeps} onValue={(extraDeps) => setSetupDraft({ ...setupDraft, extraDeps })} />
          <div>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const extraDependencies = JSON.parse(setupDraft.extraDeps || "{}") as Record<string, string>;
                return api.invoke("ds:update", ds.id, {
                  setup: {
                    ...ds.setup,
                    globalCss: setupDraft.css.split("\n").map((s) => s.trim()).filter(Boolean),
                    provider: setupDraft.providerName.trim()
                      ? {
                          importName: setupDraft.providerName.trim(),
                          importPath: setupDraft.providerPath.trim(),
                          props: setupDraft.providerProps.trim() || undefined,
                        }
                      : undefined,
                    extraDependencies,
                    vuePlugin:
                      ds.framework === "vue" && setupDraft.pluginName.trim()
                        ? {
                            importName: setupDraft.pluginName.trim(),
                            importPath: setupDraft.pluginPath.trim(),
                            options: setupDraft.pluginOptions.trim() || undefined,
                            factory: setupDraft.pluginFactory || undefined,
                          }
                        : undefined,
                    angularModules:
                      ds.framework === "angular"
                        ? setupDraft.modules
                            .split("\n")
                            .map((line) => /^\s*([A-Za-z_$][\w$]*)\s+from\s+(\S+)\s*$/.exec(line))
                            .filter((m): m is RegExpExecArray => m !== null)
                            .map((m) => ({ importName: m[1], importPath: m[2] }))
                        : ds.setup.angularModules,
                    angularProviders: ds.setup.angularProviders,
                  },
                });
              })
            }
          >
            Save setup
          </button>
          </div>
        </section>
        </TabPanel>

        <TabPanel name="templates">
          <TemplatesTab ds={ds} onChange={onChange} />
        </TabPanel>

        <TabPanel name="guidelines">
        <section className="card form">
          <p className="muted">
            Usage rules from your design system team, sent verbatim with every request. Write them as you would for a new
            engineer: when to use which component, layout conventions, content rules, accessibility requirements.
          </p>
          <TextArea label="Guidelines" hideLabel rows={16} value={guidelines} onValue={setGuidelines} />
          <div>
            <button className="primary" disabled={busy || guidelines === ds.guidelines} onClick={() => run(() => api.invoke("ds:update", ds.id, { guidelines }))}>
              Save guidelines
            </button>
          </div>
        </section>
        </TabPanel>

        <TabPanel name="prompt">
        <section className="card">
          <p className="muted">
            Exactly what the model receives about this design system ({Math.round(rules.length / 4).toLocaleString()} tokens,
            roughly). It is cached between turns.
          </p>
          <pre className="code">{rules}</pre>
        </section>
        </TabPanel>
      </Tabs>
    </div>
  );
}

function DescriptionField({ component, onSave }: { component: ComponentInfo; onSave(description: string): void }) {
  const [value, setValue] = useState(component.description ?? "");
  return (
    <TextArea
      label={`${component.name} description`}
      hideLabel
      rows={2}
      value={value}
      onValue={setValue}
      onCommit={(v) => v !== (component.description ?? "") && onSave(v)}
    />
  );
}

function TemplatesTab({ ds, onChange }: { ds: DesignSystem; onChange(ds: DesignSystem): void }) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  useEffect(() => {
    void api.invoke("templates:list").then(setTemplates);
  }, []);
  const fits = templates.filter((t) => isCompatible(t, ds));
  const current = defaultTemplateFor(ds, templates);
  const pkg = FRAMEWORK_PACKAGE[ds.framework];
  const range = ds.peerDependencies?.[pkg];
  return (
    <section className="card form">
      <p className="muted">
        New apps with {ds.name} start from its default template. Any {FRAMEWORK_LABELS[ds.framework]} template can load it; add your own under
        Templates.
        {range ? ` ${ds.name} needs ${pkg} ${range}, so built-in templates generate a matching version.` : ""}
      </p>
      <div className="provider-grid" role="group" aria-label="Default template">
        {fits.map((t) => (
          <button
            key={t.id}
            className="provider-card"
            aria-pressed={t.id === current?.id}
            onClick={() =>
              t.id !== current?.id &&
              api
                .invoke("ds:update", ds.id, { defaultTemplateId: t.id })
                .then((updated) => {
                  onChange(updated);
                  toast(`New ${ds.name} apps use ${t.name}.`, "success");
                })
                .catch((e) => toast(errorMessage(e), "danger"))
            }
          >
            <span className="provider-card-head">
              <strong>{t.name}</strong>
              <span className="tag">{t.stack}</span>
              {t.id === current?.id && <Icon name="check" size={14} className="provider-check" />}
            </span>
            <span className="muted small">{t.description || (t.source.kind === "builtin" ? "Built in" : "Custom template")}</span>
            {t.warnings.length > 0 && <span className="small warn-text">{t.warnings.length} setup warning(s)</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
