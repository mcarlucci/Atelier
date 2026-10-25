import { useEffect, useState } from "react";
import type { DesignSystem, FrameworkId } from "@shared/types";
import { FRAMEWORK_LABELS, isCompatible, type TemplateInfo } from "@shared/templates";
import { api, errorMessage } from "../api";
import type { Route } from "../App";
import { relativeTime } from "../format";
import { Icon } from "../ui/icons";
import { Alert, Disclosure, Progress, Select, TextArea, TextField, ToggleGroup, toast, useConfirm } from "../ui/slab";

const FRAMEWORKS: FrameworkId[] = ["react", "vue", "angular"];

export default function TemplatesPage({ selectedId, navigate }: { selectedId?: string; navigate(r: Route): void }) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [systems, setSystems] = useState<DesignSystem[]>([]);
  const refresh = () => {
    void api.invoke("templates:list").then(setTemplates);
    void api.invoke("ds:list").then(setSystems);
  };
  useEffect(refresh, []);

  const selected = templates.find((t) => t.id === selectedId);
  return (
    <div className="split">
      <div className="list-pane">
        <div className="list-head">
          <h1>Templates</h1>
          <button className="sm" onClick={() => navigate({ page: "templates" })}>
            <Icon name="plus" size={14} />
            Add
          </button>
        </div>
        {FRAMEWORKS.map((fw) => (
          <div key={fw} className="list-group">
            <div className="side-head muted small">{FRAMEWORK_LABELS[fw]}</div>
            {templates
              .filter((t) => t.framework === fw)
              .map((t) => (
                <button key={t.id} className="list-item" aria-current={t.id === selectedId ? "true" : undefined} onClick={() => navigate({ page: "templates", selectedId: t.id })}>
                  <span className="row">
                    <span className="ds-mark">
                      <Icon name="layout" size={14} />
                    </span>
                    <strong className="truncate grow">{t.name}</strong>
                    {t.warnings.length > 0 && <span className="state-dot needs-auth" title={`${t.warnings.length} warning(s)`} />}
                  </span>
                  <span className="muted small">
                    {t.stack} · {t.source.kind === "builtin" ? "Built in" : "Custom"}
                  </span>
                </button>
              ))}
          </div>
        ))}
      </div>
      <div className="detail-pane">
        {selected ? (
          <TemplateDetail
            key={selected.id}
            template={selected}
            systems={systems}
            onChanged={refresh}
            onDeleted={() => {
              refresh();
              navigate({ page: "templates" });
            }}
          />
        ) : (
          <AddTemplate
            onAdded={(t) => {
              refresh();
              navigate({ page: "templates", selectedId: t.id });
            }}
          />
        )}
      </div>
    </div>
  );
}

function AddTemplate({ onAdded }: { onAdded(t: TemplateInfo): void }) {
  const [kind, setKind] = useState<"folder" | "git">("folder");
  const [folder, setFolder] = useState("");
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const t = await api.invoke("templates:import", kind === "folder" ? { kind, path: folder } : { kind, url: url.trim(), ref: ref.trim() || undefined });
      toast(`Added the “${t.name}” template.`, "success");
      onAdded(t);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-scroll">
      <div>
        <h1>Add a sandbox template</h1>
        <p className="muted">
          A template is the starter app that design system components render in. Atelier has built-in React, Vue and Angular templates; add
          your own to prototype inside your product's real shell, with its routing, layout and build setup. New apps copy the template, add the
          design system package, and get a generated setup file that loads its styles and providers.
        </p>
      </div>
      <section className="card form">
        <ToggleGroup
          label="Source"
          value={kind}
          onValue={(v) => setKind(v as "folder" | "git")}
          options={[
            { value: "folder", label: "Local folder" },
            { value: "git", label: "Git repository" },
          ]}
        />
        {kind === "folder" ? (
          <div className="row end">
            <TextField className="grow" label="Starter app folder (contains package.json)" placeholder="/path/to/acme-app-shell" value={folder} onValue={setFolder} />
            <button onClick={() => api.invoke("templates:select-folder").then((p) => p && setFolder(p))}>Browse…</button>
          </div>
        ) : (
          <div className="row start">
            <TextField className="grow" label="Repository URL" placeholder="https://github.com/acme/app-shell.git" value={url} onValue={setUrl} />
            <TextField label="Branch or tag (optional)" placeholder="main" value={ref} onValue={setRef} />
          </div>
        )}
        <Alert tone="warning">Apps made from a template run its code and its packages' install scripts on your computer. Only add templates you trust.</Alert>
        <div>
          <button className="primary" disabled={busy || (kind === "folder" ? !folder.trim() : !url.trim())} onClick={submit}>
            {busy ? "Importing…" : "Import template"}
          </button>
        </div>
        {busy && <Progress label="Importing template" />}
        {error && (
          <Alert tone="danger">
            <pre className="plain">{error}</pre>
          </Alert>
        )}
      </section>
      <section className="card">
        <h2>Detected automatically</h2>
        <p className="muted small">
          The framework (React, Vue or Angular), the stack (Vite, Next.js, Nuxt, Angular CLI and others) and the dev command come from
          package.json. To set them yourself, add <code>atelier.template.json</code> to the template root:
        </p>
        <pre className="code small">{`{
  "name": "Acme app shell",
  "framework": "react",
  "devCommand": "npx vite --port {port} --strictPort --host 127.0.0.1",
  "setupFile": "src/design-system/DesignSystemRoot.tsx",
  "rules": "Pages live in src/routes. Use the AppLayout component for every page."
}`}</pre>
        <p className="muted small">
          The template must import the setup file: wrap the React root in <code>&lt;DesignSystemRoot&gt;</code>, call{" "}
          <code>installDesignSystem(app)</code> and render <code>&lt;DesignSystemRoot&gt;</code> in Vue, or add <code>...designSystemProviders</code>{" "}
          to the Angular app config and <code>src/design-system.css</code> to angular.json styles. Atelier checks this and warns if it is missing.
        </p>
      </section>
    </div>
  );
}

function TemplateDetail({
  template: t,
  systems,
  onChanged,
  onDeleted,
}: {
  template: TemplateInfo;
  systems: DesignSystem[];
  onChanged(): void;
  onDeleted(): void;
}) {
  const builtin = t.source.kind === "builtin";
  const [draft, setDraft] = useState({ name: t.name, description: t.description, framework: t.framework, devCommand: t.devCommand, setupFile: t.setupFile, rules: t.rules });
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<string[] | null>(null);
  const [confirmNode, confirm] = useConfirm();
  const compatible = systems.filter((ds) => isCompatible(t, ds));

  useEffect(() => {
    if (!builtin) void api.invoke("templates:files", t.id).then(setFiles, () => setFiles([]));
  }, [t.id, builtin]);

  const act = async (fn: () => Promise<unknown>, note: string) => {
    setBusy(true);
    try {
      await fn();
      toast(note, "success");
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-scroll">
      {confirmNode}
      <div className="list-head">
        <div className="row">
          <span className="hero-empty-icon">
            <Icon name="layout" size={20} />
          </span>
          <div>
            <h1>{t.name}</h1>
            <p className="muted small row">
              <span className="tag accent">{FRAMEWORK_LABELS[t.framework]}</span>
              <span className="tag">{t.stack}</span>
              {t.source.kind === "builtin" ? "Built in" : t.source.kind === "folder" ? t.source.path : `${t.source.url}${t.source.ref ? `#${t.source.ref}` : ""}`}
              {t.importedAt ? ` · imported ${relativeTime(t.importedAt)}` : ""}
            </p>
          </div>
        </div>
        {!builtin && (
          <div className="row">
            <button disabled={busy} onClick={() => act(() => api.invoke("templates:refresh", t.id), "Template refreshed from its source.")}>
              <Icon name="refresh" size={14} />
              Refresh from source
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete ${t.name}?`,
                  body: "The template's saved files and settings are removed. Apps made from it must be deleted first.",
                  confirmLabel: "Delete",
                  danger: true,
                });
                if (ok) await api.invoke("templates:delete", t.id).then(onDeleted, (e) => toast(errorMessage(e), "danger"));
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {t.warnings.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}

      <section className="card form">
        <h2>Works with</h2>
        {compatible.length === 0 ? (
          <p className="muted small">No {FRAMEWORK_LABELS[t.framework]} design system is imported yet. Import one to build apps with this template.</p>
        ) : (
          <div className="chip-list">
            {compatible.map((ds) => (
              <span key={ds.id} className="tag">
                {ds.name}
                {ds.defaultTemplateId === t.id ? " · default" : ""}
              </span>
            ))}
          </div>
        )}
        <p className="muted small">
          Any {FRAMEWORK_LABELS[t.framework]} design system can load this template. Choose each design system's default under Design systems,
          then Templates.
        </p>
      </section>

      {builtin ? (
        <section className="card form">
          <p>{t.description}</p>
          <dl className="facts">
            <dt>Versions</dt>
            <dd>
              {FRAMEWORK_LABELS[t.framework]} {t.versions?.join(", ")}. Each new app gets the newest version that the design system's peer
              dependencies allow and the installed Node.js can run.
            </dd>
            <dt>Dev command</dt>
            <dd>
              <code>{t.devCommand}</code>
            </dd>
            <dt>Setup file</dt>
            <dd>
              <code>{t.setupFile}</code>
              {t.framework === "angular" && (
                <>
                  {" "}
                  and <code>src/design-system.css</code>
                </>
              )}
            </dd>
          </dl>
        </section>
      ) : (
        <section className="card form">
          <div className="row start">
            <TextField className="grow" label="Name" value={draft.name} onValue={(name) => setDraft({ ...draft, name })} />
            <Select
              label="Framework"
              value={draft.framework}
              onValue={(v) => setDraft({ ...draft, framework: v as FrameworkId })}
              options={FRAMEWORKS.map((f) => ({ value: f, label: FRAMEWORK_LABELS[f] }))}
            />
          </div>
          <TextField label="Description" value={draft.description} onValue={(description) => setDraft({ ...draft, description })} />
          <TextField
            label="Dev command"
            value={draft.devCommand}
            onValue={(devCommand) => setDraft({ ...draft, devCommand })}
            description="Run in the app folder. {port} is replaced with the preview port. Leading NAME=value pairs set environment variables."
          />
          <TextField
            label="Setup file"
            value={draft.setupFile}
            onValue={(setupFile) => setDraft({ ...draft, setupFile })}
            description="Generated from the design system setup and imported by the template. The AI may not edit it."
          />
          <TextArea
            label="Notes for the AI (optional)"
            rows={4}
            placeholder="Where pages and routes live, layout components to use, naming conventions…"
            value={draft.rules}
            onValue={(rules) => setDraft({ ...draft, rules })}
          />
          <div>
            <button className="primary" disabled={busy} onClick={() => act(() => api.invoke("templates:update", t.id, draft), "Template saved.")}>
              Save
            </button>
          </div>
        </section>
      )}

      {!builtin && files && (
        <Disclosure label={`Files (${files.length}${files.length >= 500 ? "+" : ""})`} className="files-disclosure">
          <pre className="code small">{files.join("\n")}</pre>
        </Disclosure>
      )}
    </div>
  );
}
