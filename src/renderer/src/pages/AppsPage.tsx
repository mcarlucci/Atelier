import { useEffect, useRef, useState } from "react";
import type { AppRecord, DesignSystem } from "@shared/types";
import { BUILTIN_TEMPLATE_IDS, defaultTemplateFor, FRAMEWORK_LABELS, isCompatible, templateVersionProblem, type TemplateInfo } from "@shared/templates";
import { api, errorMessage } from "../api";
import type { Route } from "../App";
import AppAvatar from "../components/AppAvatar";
import AppNameInput from "../components/AppNameInput";
import ModelMenu from "../components/ModelMenu";
import PromptBox from "../components/PromptBox";
import { nameFromPrompt, relativeTime } from "../format";
import { Icon, type IconName } from "../ui/icons";
import { Alert, Menu, MenuItem, Pagination, Select, TextField, toast, useConfirm } from "../ui/slab";

const IDEAS: { icon: IconName; title: string; prompt: string }[] = [
  { icon: "form", title: "Settings page", prompt: "A settings page for notification preferences, grouped into sections, with a save confirmation" },
  { icon: "chart", title: "Analytics dashboard", prompt: "An analytics dashboard with KPI cards, a date range filter and a table of recent activity" },
  { icon: "users", title: "Team directory", prompt: "A team directory with search, role filters and a detail panel for each person" },
  { icon: "layout", title: "Onboarding flow", prompt: "A three-step onboarding flow with a progress indicator, validation and a summary step" },
  { icon: "cart", title: "Checkout", prompt: "A checkout page with a cart summary, shipping form, payment method choice and order confirmation" },
  { icon: "bell", title: "Notification center", prompt: "A notification center with unread badges, filters by type and mark-all-as-read" },
  { icon: "message", title: "Support inbox", prompt: "A support inbox with a conversation list, a message thread and a reply composer" },
  { icon: "package", title: "Product catalog", prompt: "A product catalog with category filters, sorting, and a product detail dialog" },
];
const IDEAS_SHOWN = 4;
const APPS_PER_PAGE = 6;

export default function AppsPage({ apps, onAppsChanged, navigate }: { apps: AppRecord[]; onAppsChanged(): void; navigate(r: Route): void }) {
  const [systems, setSystems] = useState<DesignSystem[] | null>(null);
  const [dsId, setDsId] = useState("");
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ideaOffset, setIdeaOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmNode, confirm] = useConfirm();
  const focusRef = useRef<() => void>(undefined);
  const [previews, setPreviews] = useState<Record<string, string | null>>({});

  // What was last saved, so mounting the page doesn't write the same choice back.
  const savedChoice = useRef<string | null>(null);
  useEffect(() => {
    void Promise.all([api.invoke("ds:list"), api.invoke("templates:list"), api.invoke("settings:get")]).then(([list, tpls, settings]) => {
      setTemplates(tpls);
      setSystems(list);
      // The last design system and template used, while they still exist and fit each other.
      const ds = list.find((s) => s.id === settings.lastDesignSystemId) ?? list[0];
      if (ds) {
        const last = tpls.find((t) => t.id === settings.lastTemplateId);
        const tpl = last && isCompatible(last, ds) ? last : defaultTemplateFor(ds, tpls);
        setDsId(ds.id);
        setTemplateId(tpl?.id ?? "");
        savedChoice.current = `${settings.lastDesignSystemId ?? ""}|${settings.lastTemplateId ?? ""}`;
      }
    });
  }, []);

  useEffect(() => {
    if (!dsId || savedChoice.current === null || savedChoice.current === `${dsId}|${templateId}`) return;
    savedChoice.current = `${dsId}|${templateId}`;
    void api.invoke("settings:set", { lastDesignSystemId: dsId, lastTemplateId: templateId });
  }, [dsId, templateId]);

  const appIds = apps.map((a) => a.id).join(",");
  useEffect(() => {
    const load = (id: string) => void api.invoke("app:preview-image", id).then((src) => setPreviews((p) => ({ ...p, [id]: src })));
    for (const id of appIds ? appIds.split(",") : []) load(id);
    return api.on("app:preview-image", (e) => load(e.appId));
  }, [appIds]);

  // The pickers filter each other: a design system keeps a template that can load it, and vice versa.
  const pickDs = (id: string) => {
    setDsId(id);
    const next = systems?.find((s) => s.id === id);
    const current = templates.find((t) => t.id === templateId);
    if (next && (!current || !isCompatible(current, next))) setTemplateId(defaultTemplateFor(next, templates)?.id ?? "");
  };
  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    const current = systems?.find((s) => s.id === dsId);
    if (t && (!current || !isCompatible(t, current))) {
      const fit = systems?.find((s) => isCompatible(t, s));
      if (fit) setDsId(fit.id);
    }
  };

  const create = async (text: string) => {
    if (!text.trim() || !dsId) return;
    setBusy(true);
    setError(null);
    try {
      const app = await api.invoke("app:create", { name: nameFromPrompt(text), designSystemId: dsId, templateId: templateId || undefined });
      for (const w of app.warnings ?? []) toast(w, "warning");
      navigate({ page: "workspace", appId: app.id, initialPrompt: text.trim() });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const remove = async (app: AppRecord) => {
    const ok = await confirm({
      title: `Delete ${app.name}?`,
      body: "The app folder, its chats and its version history are deleted from this computer. This cannot be undone.",
      confirmLabel: "Delete app",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.invoke("app:delete", app.id);
      toast(`${app.name} deleted.`, "success");
      onAppsChanged();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };

  const dsName = (id: string) => systems?.find((s) => s.id === id)?.name ?? "Unknown design system";
  const ds = systems?.find((s) => s.id === dsId);
  const template = templates.find((t) => t.id === templateId);
  const versionProblem = template && ds ? templateVersionProblem(template, ds) : null;
  const builtinForDs = ds ? templates.find((t) => t.id === BUILTIN_TEMPLATE_IDS[ds.framework]) : undefined;
  const frameworksWithDs = new Set((systems ?? []).map((s) => s.framework));
  const ideas = Array.from({ length: IDEAS_SHOWN }, (_, i) => IDEAS[(ideaOffset + i) % IDEAS.length]);
  const recent = [...apps].sort((a, b) => b.updatedAt - a.updatedAt);
  const templateName = (app: AppRecord) =>
    templates.find((t) => t.id === (app.templateId ?? BUILTIN_TEMPLATE_IDS[app.framework]))?.name ?? "Template removed";
  // Matches the name, design system or template shown on the card.
  const needle = query.trim().toLowerCase();
  const matching = needle
    ? recent.filter((app) => [app.name, dsName(app.designSystemId), templateName(app)].some((s) => s.toLowerCase().includes(needle)))
    : recent;
  const pages = Math.max(1, Math.ceil(matching.length / APPS_PER_PAGE));
  // Clamped, so deleting the last app on a page shows the one before.
  const currentPage = Math.min(page, pages);
  const shown = matching.slice((currentPage - 1) * APPS_PER_PAGE, currentPage * APPS_PER_PAGE);

  if (systems === null) return <div className="page-scroll" />;

  return (
    <div className="page-scroll home">
      {confirmNode}
      <section className="hero">
        <div className="hero-badge">
          <Icon name="sparkles" size={13} />
          {ds ? `Built only from ${ds.name}${template ? ` in ${template.name}` : ""}` : "Bring your own design system"}
        </div>
        <h1 className="hero-title">Workshop your idea</h1>
        {systems.length === 0 ? (
          <div className="hero-empty card">
            <span className="hero-empty-icon">
              <Icon name="palette" size={22} />
            </span>
            <div className="grow">
              <h2>Import your design system first</h2>
              <p className="muted">
                Atelier builds prototypes only from your organization's components. Import a React, Vue or Angular package to get started.
              </p>
            </div>
            <button className="primary" onClick={() => navigate({ page: "design-systems" })}>
              Import a design system
            </button>
          </div>
        ) : (
          <>
            <PromptBox
              value={prompt}
              onValue={setPrompt}
              onSubmit={() => void create(prompt)}
              busy={busy}
              autoFocus
              focusRef={focusRef}
              placeholder="Describe the screen or feature you want to prototype…"
              label="Describe your app"
              footer={
                <>
                  <ModelMenu onOpenSettings={() => navigate({ page: "settings" })} />
                  <Select
                    className="ds-picker"
                    label="Design system"
                    hideLabel
                    value={dsId}
                    onValue={pickDs}
                    options={systems.map((s) => ({ value: s.id, label: `${s.name} · ${FRAMEWORK_LABELS[s.framework]}` }))}
                  />
                  <Select
                    className="ds-picker"
                    label="Sandbox template"
                    hideLabel
                    value={templateId}
                    onValue={pickTemplate}
                    options={templates.map((t) => ({
                      value: t.id,
                      label: !frameworksWithDs.has(t.framework)
                        ? `${t.name} (no ${FRAMEWORK_LABELS[t.framework]} design system)`
                        : t.frameworkMajor !== undefined
                          ? `${t.name} · ${FRAMEWORK_LABELS[t.framework]} ${t.frameworkMajor}`
                          : t.name,
                      disabled: !frameworksWithDs.has(t.framework),
                    }))}
                  />
                </>
              }
            />
            {versionProblem && (
              <Alert tone="warning">
                <div className="alert-row">
                  <span>{versionProblem}</span>
                  {builtinForDs && <button onClick={() => pickTemplate(builtinForDs.id)}>Use {builtinForDs.name}</button>}
                </div>
              </Alert>
            )}
            {error && (
              <Alert tone="danger" onDismiss={() => setError(null)}>
                {error}
              </Alert>
            )}
            <div className="ideas">
              {ideas.map((idea) => (
                <button
                  key={idea.title}
                  className="idea"
                  disabled={busy}
                  onClick={() => {
                    setPrompt(idea.prompt);
                    focusRef.current?.();
                  }}
                >
                  <Icon name={idea.icon} size={14} />
                  {idea.title}
                </button>
              ))}
              <button className="idea ghost" onClick={() => setIdeaOffset((o) => (o + IDEAS_SHOWN) % IDEAS.length)}>
                <Icon name="shuffle" size={14} />
                More ideas
              </button>
            </div>
          </>
        )}
      </section>

      {recent.length > 0 && (
        <section className="recent">
          <div className="section-head">
            <h2>Your apps</h2>
            <span className="muted small">{needle ? `${matching.length} of ${recent.length}` : recent.length}</span>
            {recent.length > APPS_PER_PAGE && (
              <TextField
                className="app-search"
                type="search"
                label="Search apps"
                hideLabel
                placeholder="Search apps"
                value={query}
                onValue={(q) => {
                  setQuery(q);
                  setPage(1);
                }}
              />
            )}
          </div>
          {shown.length === 0 && <p className="muted">No apps match "{query.trim()}".</p>}
          <div className="grid app-grid">
            {shown.map((app) => {
              const renaming = app.id === renamingId;
              const preview = (
                <span className="app-card-preview">
                  {previews[app.id] ? (
                    <img src={previews[app.id]!} alt="" draggable={false} />
                  ) : (
                    <span className="app-card-placeholder">
                      <AppAvatar app={app} size={56} />
                      <span className="muted small">Open the app to generate a preview</span>
                    </span>
                  )}
                </span>
              );
              const body = (
                <span className="app-card-body">
                  <AppAvatar app={app} size={36} />
                  <span className="app-card-text">
                    {renaming ? (
                      <AppNameInput
                        app={app}
                        onDone={(updated) => {
                          setRenamingId(null);
                          if (updated) onAppsChanged();
                        }}
                      />
                    ) : (
                      <strong className="truncate">{app.name}</strong>
                    )}
                    <span className="muted small truncate">
                      {dsName(app.designSystemId)} · {templateName(app)}
                    </span>
                    <span className="muted small">Edited {relativeTime(app.updatedAt)}</span>
                  </span>
                </span>
              );
              return (
              <div key={app.id} className="app-card">
                {/* The name field can't sit inside a button, so the card stops being one while renaming. */}
                {renaming ? (
                  <div className="app-card-main">
                    {preview}
                    {body}
                  </div>
                ) : (
                  <button className="app-card-main" onClick={() => navigate({ page: "workspace", appId: app.id })}>
                    {preview}
                    {body}
                  </button>
                )}
                {!renaming && (
                  <button className="icon-btn app-card-rename" aria-label={`Rename ${app.name}`} title="Rename" onClick={() => setRenamingId(app.id)}>
                    <Icon name="pencil" size={14} />
                  </button>
                )}
                <Menu
                  label={`${app.name} actions`}
                  className="app-card-menu"
                  anchor={
                    <button className="icon-btn" aria-label={`${app.name} actions`}>
                      <Icon name="more" />
                    </button>
                  }
                >
                  <MenuItem onSelect={() => navigate({ page: "workspace", appId: app.id })}>
                    <Icon name="message" size={14} />
                    Open
                  </MenuItem>
                  <MenuItem onSelect={() => setRenamingId(app.id)}>
                    <Icon name="pencil" size={14} />
                    Rename
                  </MenuItem>
                  <MenuItem onSelect={() => void api.invoke("app:reveal", app.id)}>
                    <Icon name="folder" size={14} />
                    Show files
                  </MenuItem>
                  <MenuItem className="danger" onSelect={() => void remove(app)}>
                    <Icon name="trash" size={14} />
                    Delete
                  </MenuItem>
                </Menu>
              </div>
              );
            })}
          </div>
          {pages > 1 && <Pagination className="app-pagination" label="Your apps pages" page={currentPage} total={pages} onPage={setPage} />}
        </section>
      )}
    </div>
  );
}
