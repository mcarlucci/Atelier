import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ConnectorView } from "@shared/connectors";
import { PREVIEW_SELECT_MESSAGE } from "@shared/ipc";
import type { PreviewEdit, SelectedElement } from "@shared/types";
import type { AppRecord, ChatRecord, DesignSystem, MessageRecord, RunnerStatus, VersionInfo } from "@shared/types";
import { api, errorMessage } from "../api";
import type { Route } from "../App";
import AppAvatar from "../components/AppAvatar";
import AppNameInput from "../components/AppNameInput";
import MessageView, { ThinkingDots } from "../components/MessageView";
import ModelMenu from "../components/ModelMenu";
import SelectionChip from "../components/SelectionChip";
import PromptBox from "../components/PromptBox";
import { relativeTime, storedNumber } from "../format";
import { Icon, type IconName } from "../ui/icons";
import { Alert, Menu, MenuItem, Progress, TabPanel, Tabs, ToggleGroup, Toolbar, Tooltip, Tree, toast, useConfirm, type TreeNode } from "../ui/slab";

const tabLabel = (icon: IconName, text: string) => (
  <span className="tab-label">
    <Icon name={icon} size={14} />
    {text}
  </span>
);
const TABS = [
  { id: "preview", label: tabLabel("eye", "Preview") },
  { id: "code", label: tabLabel("code", "Code") },
  { id: "versions", label: tabLabel("history", "Versions") },
];
const DEVICES = { desktop: "100%", tablet: "768px", mobile: "390px" } as const;
type Device = keyof typeof DEVICES;
const MAX_CONSOLE_CHARS = 200_000;
const CHAT_WIDTH_KEY = "atelier.chatWidth";
const MIN_CHAT = 340;

/** A prompt to send from outside the chat panel. The object identity marks it as sent once. */
type Queued = { text: string };
/** First prompts from the home page already sent, so a remount does not send them again. */
const sentInitialPrompts = new Set<string>();

export default function WorkspacePage({ appId, initialPrompt, navigate }: { appId: string; initialPrompt?: string; navigate(r: Route): void }) {
  const [app, setApp] = useState<AppRecord | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [ds, setDs] = useState<DesignSystem | null>(null);
  const [chats, setChats] = useState<ChatRecord[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("preview");
  const [status, setStatus] = useState<RunnerStatus>({ state: "stopped" });
  const [consoleText, setConsoleText] = useState("");
  const [errorCount, setErrorCount] = useState(0);
  const [lastError, setLastError] = useState("");
  const [versionsKey, setVersionsKey] = useState(0);
  const [queued, setQueued] = useState<Queued | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<SelectedElement | null>(null);
  const [chatWidth, setChatWidth] = useState(() => storedNumber(CHAT_WIDTH_KEY, 440));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const apps = await api.invoke("app:list");
      const found = apps.find((a) => a.id === appId) ?? null;
      if (cancelled || !found) return;
      setApp(found);
      setDs(await api.invoke("ds:get", found.designSystemId));
      let list = await api.invoke("chat:list", appId);
      if (list.length === 0) list = [await api.invoke("chat:create", appId)];
      if (cancelled) return;
      setChats(list);
      setChatId(list[0].id);
      if (initialPrompt && !sentInitialPrompts.has(appId)) {
        sentInitialPrompts.add(appId);
        setQueued({ text: initialPrompt });
      }
      setStatus(await api.invoke("run:status", appId));
      // Start the preview on open.
      void api.invoke("run:start", appId);
    })();
    return () => {
      cancelled = true;
    };
  }, [appId, initialPrompt]);

  useEffect(() => {
    const offStatus = api.on("run:status", (e) => e.appId === appId && setStatus(e.status));
    const offOutput = api.on("run:output", (e) => {
      if (e.appId !== appId) return;
      setConsoleText((t) => (t + e.text).slice(-MAX_CONSOLE_CHARS));
      if (e.stream === "stderr" && e.text.trim()) {
        setErrorCount((n) => n + 1);
        setLastError(e.text.trim());
      }
    });
    return () => {
      offStatus();
      offOutput();
    };
  }, [appId]);

  const onTurnDone = useCallback(() => {
    setVersionsKey((k) => k + 1);
    void api.invoke("chat:list", appId).then(setChats);
  }, [appId]);

  const fixError = (text: string) => setQueued({ text: `Fix this error in the app:\n\n${text.slice(-2000)}` });

  if (!app || !ds) {
    return (
      <div className="workspace loading">
        <ThinkingDots label="Opening app" />
      </div>
    );
  }

  const currentChat = chats.find((c) => c.id === chatId);

  return (
    <div className="workspace">
      <section className="chat-pane" style={{ width: chatWidth }}>
        <header className="pane-head">
          <Tooltip label="All apps">
            <button className="icon-btn" aria-label="All apps" onClick={() => navigate({ page: "apps" })}>
              <Icon name="arrowLeft" />
            </button>
          </Tooltip>
          <AppAvatar app={app} size={26} />
          <div className="pane-title">
            {renaming ? (
              <AppNameInput
                app={app}
                onDone={(updated) => {
                  setRenaming(false);
                  if (updated) setApp(updated);
                }}
              />
            ) : (
              <span className="pane-title-name">
                <strong className="truncate">{app.name}</strong>
                <button className="icon-btn rename-btn" aria-label={`Rename ${app.name}`} title="Rename" onClick={() => setRenaming(true)}>
                  <Icon name="pencil" size={13} />
                </button>
              </span>
            )}
            <span className="muted small truncate">{currentChat?.title ?? "New chat"}</span>
          </div>
          {chats.length > 0 && (
            <Menu
              label="Chat history"
              anchor={
                <button className="icon-btn" aria-label="Chat history" title="Chat history">
                  <Icon name="history" />
                </button>
              }
            >
              {chats.map((c) => (
                <MenuItem key={c.id} label={c.title} onSelect={() => setChatId(c.id)} className={c.id === chatId ? "current" : undefined}>
                  <Icon name="message" size={14} />
                  <span className="grow truncate">{c.title}</span>
                  <span className="muted small">{relativeTime(c.createdAt)}</span>
                </MenuItem>
              ))}
            </Menu>
          )}
          <Tooltip label="New chat">
            <button
              className="icon-btn"
              aria-label="New chat"
              onClick={async () => {
                const chat = await api.invoke("chat:create", appId);
                setChats((list) => [chat, ...list]);
                setChatId(chat.id);
              }}
            >
              <Icon name="plus" />
            </button>
          </Tooltip>
        </header>
        {chatId && (
          <ChatPanel
            key={chatId}
            chatId={chatId}
            app={app}
            ds={ds}
            queued={queued}
            selection={selection}
            onClearSelection={() => setSelection(null)}
            onQueuedSent={() => setQueued(null)}
            onTurnDone={onTurnDone}
            onOpenSettings={() => navigate({ page: "settings" })}
            onOpenConnectors={() => navigate({ page: "connectors" })}
          />
        )}
      </section>

      <Resizer
        width={chatWidth}
        onWidth={setChatWidth}
        onCommit={(w) => localStorage.setItem(CHAT_WIDTH_KEY, String(w))}
      />

      <section className="preview-pane">
        <Toolbar label="Preview controls" className="preview-toolbar">
          <StatusBadge status={status} />
          <Tooltip label="Restart dev server">
            <button className="icon-btn" aria-label="Restart dev server" onClick={() => api.invoke("run:restart", appId)}>
              <Icon name="power" />
            </button>
          </Tooltip>
          <Tooltip label="Reinstall packages, then restart">
            <button className="icon-btn" aria-label="Rebuild" onClick={() => api.invoke("run:restart", appId, { reinstall: true })}>
              <Icon name="wrench" />
            </button>
          </Tooltip>
          <Tooltip label="Show files">
            <button className="icon-btn" aria-label="Show files" onClick={() => api.invoke("app:reveal", appId)}>
              <Icon name="folder" />
            </button>
          </Tooltip>
        </Toolbar>
        <Tabs label="Workspace views" value={tab} onValue={setTab} tabs={TABS} className="workspace-tabs">
          <TabPanel name="preview" className="tab-body">
            <PreviewView
              appId={appId}
              status={status}
              onFixError={fixError}
              selecting={selecting}
              onSelecting={setSelecting}
              onSelected={setSelection}
              onSendPrompt={(text) => setQueued({ text })}
              onSaved={() => setVersionsKey((k) => k + 1)}
            />
          </TabPanel>
          <TabPanel name="code" className="tab-body">
            <CodeView appId={appId} refreshKey={versionsKey} />
          </TabPanel>
          <TabPanel name="versions" className="tab-body">
            <VersionsView appId={appId} refreshKey={versionsKey} onRestored={() => setVersionsKey((k) => k + 1)} />
          </TabPanel>
        </Tabs>
        <ConsoleDrawer
          text={consoleText}
          errorCount={errorCount}
          onClear={() => {
            setConsoleText("");
            setErrorCount(0);
            setLastError("");
          }}
          onFix={lastError ? () => fixError(lastError) : undefined}
        />
      </section>
    </div>
  );
}

function Resizer({ width, onWidth, onCommit }: { width: number; onWidth(w: number): void; onCommit(w: number): void }) {
  const clamp = (w: number) => Math.round(Math.max(MIN_CHAT, Math.min(w, window.innerWidth * 0.65)));
  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat"
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const w = clamp(width + (e.key === "ArrowRight" ? step : -step));
          onWidth(w);
          onCommit(w);
        }
      }}
      onPointerDown={(e) => {
        const startX = e.clientX;
        const start = width;
        let last = start;
        // The preview iframe would swallow pointer events mid-drag.
        document.body.classList.add("resizing");
        const move = (ev: PointerEvent) => {
          last = clamp(start + ev.clientX - startX);
          onWidth(last);
        };
        const up = () => {
          document.body.classList.remove("resizing");
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          onCommit(last);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    />
  );
}

function StatusBadge({ status }: { status: RunnerStatus }) {
  const text = { stopped: "Stopped", installing: "Installing", starting: "Starting", running: "Running", error: "Error" }[status.state];
  return (
    <span className={`badge ${status.state}`}>
      <span className="badge-dot" />
      {text}
    </span>
  );
}

function PreviewView({
  appId,
  status,
  onFixError,
  selecting,
  onSelecting,
  onSelected,
  onSendPrompt,
  onSaved,
}: {
  appId: string;
  status: RunnerStatus;
  onFixError(text: string): void;
  selecting: boolean;
  onSelecting(on: boolean): void;
  onSelected(el: SelectedElement): void;
  /** Sends a prompt as the next chat turn, once the chat is idle. */
  onSendPrompt(text: string): void;
  /** A new version was committed. */
  onSaved(): void;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const [path, setPath] = useState("/");
  const [draft, setDraft] = useState("/");
  const [reloadKey, setReloadKey] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  /** Text edits and moves made with the select tool, not saved yet. */
  const [edits, setEdits] = useState<PreviewEdit[]>([]);
  const [saving, setSaving] = useState(false);
  /** Set when Atelier reloads the frame itself, so the reload isn't reported as losing edits. */
  const expectReload = useRef(false);

  // Save and discard reload the page: it's the only way to undo DOM edits the framework doesn't know about.
  const reloadFrame = () => {
    expectReload.current = true;
    setReloadKey((k) => k + 1);
  };
  const discardEdits = () => {
    setEdits([]);
    reloadFrame();
  };
  const saveEdits = async () => {
    setSaving(true);
    try {
      const result = await api.invoke("preview:save-edits", appId, edits);
      if (result.committed) {
        toast("Saved as a new version.", "success");
        onSaved();
      } else {
        onSendPrompt(result.prompt);
        toast("These edits need code changes, so they went to the AI. Its reply is saved as a new version.", "info");
      }
      setEdits([]);
      reloadFrame();
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setSaving(false);
    }
  };
  const previewOrigin = status.state === "running" ? new URL(status.url).origin : null;

  // The tool lives in the preview page, injected by the main process into this app's frame only.
  const applyMode = useCallback(
    async (on: boolean) => {
      let ok = false;
      try {
        ok = await api.invoke("preview:select-mode", appId, on);
      } catch (e) {
        if (on) {
          // Usually a main process older than this window (restart Atelier).
          toast(`Selection isn't available: ${errorMessage(e)}`, "danger");
          onSelecting(false);
        }
        return;
      }
      if (on && !ok) {
        toast("The preview isn't ready to select from yet. Wait for it to load, then try again.", "warning");
        onSelecting(false);
      } else if (on) frameRef.current?.focus();
    },
    [appId, onSelecting],
  );

  useEffect(() => {
    if (previewOrigin) void applyMode(selecting);
  }, [selecting, previewOrigin, applyMode]);

  useEffect(() => () => void api.invoke("preview:select-mode", appId, false).catch(() => false), [appId]);

  // The page reports a pick or a cancel by postMessage; only this app's preview frame is listened to.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!previewOrigin || e.origin !== previewOrigin || e.source !== frameRef.current?.contentWindow) return;
      const data = e.data as { type?: unknown; element?: SelectedElement; cancelled?: boolean; edits?: unknown } | null;
      if (!data || data.type !== PREVIEW_SELECT_MESSAGE) return;
      // The tool reports its full list of pending edits after each change; the main process sanitizes them on save.
      if (Array.isArray(data.edits)) {
        setEdits(data.edits as PreviewEdit[]);
        return;
      }
      onSelecting(false);
      if (data.element && typeof data.element.tag === "string") onSelected(data.element);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [previewOrigin, onSelecting, onSelected]);

  // Escape works while focus is in Atelier too.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onSelecting(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, onSelecting]);

  if (status.state !== "running") {
    return (
      <div className="preview-empty">
        {status.state === "error" ? (
          <div className="preview-error">
            <span className="empty-icon danger">
              <Icon name="alert" size={22} />
            </span>
            <h2>The preview failed to start</h2>
            <pre className="code-block">{status.message}</pre>
            <div className="row">
              <button className="primary" onClick={() => onFixError(status.message)}>
                <Icon name="sparkles" size={14} />
                Fix with AI
              </button>
              <button onClick={() => api.invoke("run:restart", appId)}>Restart</button>
            </div>
          </div>
        ) : status.state === "stopped" ? (
          <>
            <span className="empty-icon">
              <Icon name="power" size={22} />
            </span>
            <p className="muted">The preview is stopped.</p>
            <button className="primary" onClick={() => api.invoke("run:start", appId)}>
              Start preview
            </button>
          </>
        ) : (
          <>
            <span className="spinner lg" aria-hidden="true" />
            <h2>{status.state === "installing" ? "Installing packages…" : "Starting dev server…"}</h2>
            <Progress label="Starting preview" />
            <p className="muted small">The first start installs packages and can take a minute.</p>
          </>
        )}
      </div>
    );
  }

  const origin = new URL(status.url).origin;
  const src = origin + (path.startsWith("/") ? path : `/${path}`);
  const go = (e: FormEvent) => {
    e.preventDefault();
    setPath(draft.trim() || "/");
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="preview-view">
      <div className="browser-bar">
        <Tooltip label="Reload">
          <button className="icon-btn" aria-label="Reload preview" onClick={() => setReloadKey((k) => k + 1)}>
            <Icon name="refresh" />
          </button>
        </Tooltip>
        <Tooltip label={selecting ? "Cancel selection (Esc)" : "Select an element to change"}>
          <button
            className={`icon-btn${selecting ? " active" : ""}`}
            aria-label="Select an element"
            aria-pressed={selecting}
            onClick={() => onSelecting(!selecting)}
          >
            <Icon name="pointer" />
          </button>
        </Tooltip>
        <form className="address" onSubmit={go}>
          <span className="address-origin">{origin.replace(/^https?:\/\//, "")}</span>
          <input aria-label="Preview path" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
        </form>
        <ToggleGroup
          label="Device"
          className="compact"
          value={device}
          onValue={(v) => setDevice(v as Device)}
          options={[
            { value: "desktop", label: "Desktop", content: <Icon name="monitor" size={15} /> },
            { value: "tablet", label: "Tablet", content: <Icon name="tablet" size={15} /> },
            { value: "mobile", label: "Mobile", content: <Icon name="phone" size={15} /> },
          ]}
        />
        <Tooltip label="Open in browser">
          <button className="icon-btn" aria-label="Open in browser" onClick={() => window.open(src, "_blank")}>
            <Icon name="external" />
          </button>
        </Tooltip>
      </div>
      <div className={`stage ${device}${selecting ? " selecting" : ""}`}>
        {selecting && (
          <div className="select-hint" role="status">
            Click to select · drag to move · double-click text to edit · <kbd>↑</kbd> parent · <kbd>Esc</kbd> exit
          </div>
        )}
        {edits.length > 0 && (
          <div className="edit-bar" role="region" aria-label="Unsaved preview edits">
            <span>
              {edits.length} unsaved {edits.length === 1 ? "edit" : "edits"}
            </span>
            <button className="sm ghost" disabled={saving} onClick={discardEdits}>
              Discard
            </button>
            <button className="sm primary" disabled={saving} onClick={() => void saveEdits()}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
        <iframe
          key={reloadKey}
          ref={frameRef}
          className="preview"
          src={src}
          title="App preview"
          style={{ width: DEVICES[device] }}
          onLoad={() => {
            // A reload Atelier didn't ask for (navigation, a full HMR reload) resets the page, and the edits with it.
            if (!expectReload.current && edits.length) {
              setEdits([]);
              toast("The preview reloaded, so your unsaved edits were discarded.", "warning");
            }
            expectReload.current = false;
            // A reload or navigation drops the injected tool; put it back.
            if (selecting) void applyMode(true);
          }}
        />
      </div>
    </div>
  );
}

function ConsoleDrawer({ text, errorCount, onClear, onFix }: { text: string; errorCount: number; onClear(): void; onFix?(): void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (open && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [open, text]);
  const lastLine = text.trimEnd().split("\n").at(-1) ?? "";
  return (
    <div className={`console-drawer${open ? " open" : ""}`}>
      <div className="console-head">
        <button className="console-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
          <Icon name="terminal" size={14} />
          <span>Console</span>
          {errorCount > 0 && <span className="count danger">{errorCount}</span>}
          {!open && <span className="console-last muted truncate">{lastLine}</span>}
        </button>
        {onFix && errorCount > 0 && (
          <button className="sm" onClick={onFix}>
            <Icon name="sparkles" size={13} />
            Fix error
          </button>
        )}
        {open && (
          <button className="sm ghost" onClick={onClear} disabled={!text}>
            Clear
          </button>
        )}
      </div>
      {open && (
        <pre ref={ref} className="console">
          {text || "No output yet."}
        </pre>
      )}
    </div>
  );
}

function ChatPanel({
  chatId,
  app,
  ds,
  queued,
  onQueuedSent,
  onTurnDone,
  onOpenSettings,
  onOpenConnectors,
  selection,
  onClearSelection,
}: {
  chatId: string;
  app: AppRecord;
  ds: DesignSystem;
  queued: Queued | null;
  onQueuedSent(): void;
  onTurnDone(): void;
  onOpenSettings(): void;
  onOpenConnectors(): void;
  selection: SelectedElement | null;
  onClearSelection(): void;
}) {
  const [messages, setMessages] = useState<MessageRecord[] | null>(null);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<MessageRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const sentQueued = useRef<Queued | null>(null);

  const [connectors, setConnectors] = useState<ConnectorView[]>([]);

  useEffect(() => {
    void api.invoke("connectors:list").then(setConnectors);
    return api.on("connectors:status", () => void api.invoke("connectors:list").then(setConnectors));
  }, []);
  const activeConnectors = connectors.filter((c) => c.enabled && (!c.designSystemId || c.designSystemId === ds.id));

  useEffect(() => {
    void api.invoke("chat:messages", chatId).then(setMessages);
    const offChunk = api.on("chat:chunk", (e) => {
      if (e.chatId !== chatId) return;
      setStreaming((s) =>
        s && s.id === e.messageId
          ? { ...s, content: s.content + e.text }
          : { id: e.messageId, chatId, role: "assistant", content: e.text, createdAt: Date.now() },
      );
    });
    const offDone = api.on("chat:done", (e) => {
      if (e.chatId !== chatId) return;
      setStreaming(null);
      void api.invoke("chat:messages", chatId).then(setMessages);
      onTurnDone();
    });
    return () => {
      offChunk();
      offDone();
    };
  }, [chatId, onTurnDone]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming]);

  const busy = streaming !== null || messages?.at(-1)?.role === "user";

  const composerFocus = useRef<() => void>(undefined);
  useEffect(() => {
    if (selection) composerFocus.current?.();
  }, [selection]);

  const send = async (prompt: string, picked?: SelectedElement) => {
    if (!prompt.trim()) return;
    setError(null);
    setDraft((d) => (d === prompt ? "" : d));
    if (picked) onClearSelection();
    setMessages((m) => [
      ...(m ?? []),
      { id: `pending-${Date.now()}`, chatId, role: "user", content: prompt, createdAt: Date.now(), ...(picked ? { selection: picked } : {}) },
    ]);
    setStreaming({ id: "pending", chatId, role: "assistant", content: "", createdAt: Date.now() });
    try {
      await api.invoke("chat:send", { chatId, prompt, selection: picked });
    } catch (e) {
      setStreaming(null);
      setError(errorMessage(e));
      void api.invoke("chat:messages", chatId).then(setMessages);
    }
  };

  // Prompts from the home page or a "Fix error" button run once the chat is idle.
  useEffect(() => {
    if (!queued || messages === null || busy || sentQueued.current === queued) return;
    sentQueued.current = queued;
    onQueuedSent();
    void send(queued.text);
  });

  const fixCompliance = (m: MessageRecord) => {
    const list = (m.compliance ?? []).map((i) => `- ${i.file}:${i.line} ${i.message}`).join("\n");
    void send(`Fix these design system issues so the app only uses ${ds.name}:\n${list}`);
  };

  const enabled = ds.components.filter((c) => c.enabled).length;

  return (
    <>
      <div className="messages">
        <div className="messages-inner">
          {messages?.length === 0 && !streaming && (
            <div className="chat-empty">
              <AppAvatar app={app} size={44} />
              <h2>What should {app.name} do?</h2>
              <p className="muted">
                Describe a screen or a change. Everything is built from <strong>{ds.name}</strong> ({enabled} components).
              </p>
              <div className="ideas column">
                {[
                  "A settings page for notification preferences with a save confirmation",
                  "An onboarding flow with three steps and a progress indicator",
                  "A data table with search, sorting and an empty state",
                ].map((s) => (
                  <button key={s} className="idea" onClick={() => void send(s)}>
                    <Icon name="sparkles" size={14} />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages?.map((m) => <MessageView key={m.id} message={m} onFixCompliance={busy ? undefined : fixCompliance} />)}
          {streaming && <MessageView message={streaming} streaming />}
          <div ref={endRef} />
        </div>
      </div>
      <div className="composer">
        {error && (
          <Alert tone="danger" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}
        {selection && <SelectionChip selection={selection} onClear={onClearSelection} />}
        <PromptBox
          label="Message"
          placeholder={selection ? "What should change about this element? For example: align it to the right" : "Ask Atelier to build or change something…"}
          value={draft}
          onValue={setDraft}
          focusRef={composerFocus}
          onSubmit={() => void send(draft, selection ?? undefined)}
          onStop={() => void api.invoke("chat:cancel", chatId)}
          busy={busy}
          footer={
            <>
              <ModelMenu onOpenSettings={onOpenSettings} />
              <button
                className="chip-btn"
                onClick={onOpenConnectors}
                title={activeConnectors.length ? `Connectors: ${activeConnectors.map((c) => c.name).join(", ")}` : "Add connectors such as Figma"}
              >
                <Icon name="plug" size={13} />
                {activeConnectors.length ? activeConnectors.length : "Connect"}
              </button>
              <span className="chip-static" title={`${enabled} components from ${ds.packageName}`}>
                <Icon name="palette" size={13} />
                {ds.name}
              </span>
            </>
          }
        />
      </div>
    </>
  );
}

function buildTree(files: string[], selected: string | null): TreeNode[] {
  type Dir = { dirs: Map<string, Dir>; files: string[] };
  const root: Dir = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.split("/");
    let dir = root;
    for (const p of parts.slice(0, -1)) {
      if (!dir.dirs.has(p)) dir.dirs.set(p, { dirs: new Map(), files: [] });
      dir = dir.dirs.get(p)!;
    }
    dir.files.push(f);
  }
  const toNodes = (dir: Dir, prefix: string): TreeNode[] => [
    ...[...dir.dirs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, sub]): TreeNode => {
        const id = `${prefix}${name}/`;
        return {
          id,
          label: name,
          content: (
            <span className="tree-label">
              <Icon name="folder" size={14} />
              {name}
            </span>
          ),
          expanded: id === "src/" || Boolean(selected?.startsWith(id)),
          children: toNodes(sub, id),
        };
      }),
    ...dir.files
      .sort((a, b) => a.localeCompare(b))
      .map((f): TreeNode => {
        const name = f.slice(f.lastIndexOf("/") + 1);
        return {
          id: f,
          label: name,
          content: (
            <span className="tree-label">
              <Icon name={/\.(tsx?|jsx?|css|html|json)$/.test(name) ? "fileCode" : "file"} size={14} />
              {name}
            </span>
          ),
        };
      }),
  ];
  return toNodes(root, "");
}

const EDITOR_INDENT = "  ";

function CodeView({ appId, refreshKey }: { appId: string; refreshKey: number }) {
  const [files, setFiles] = useState<string[]>([]);
  const [managed, setManaged] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  /** What's on disk; `draft` is what the editor shows. */
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changedOnDisk, setChangedOnDisk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [treeKey, setTreeKey] = useState(0);
  const [confirmNode, confirm] = useConfirm();
  const gutterRef = useRef<HTMLDivElement>(null);
  /** After Escape, Tab moves focus out instead of indenting. */
  const tabEscapes = useRef(false);
  const dirty = draft !== content;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    void api.invoke("app:files", appId).then((list) => {
      setFiles(list);
      setSelected((s) => (s && list.includes(s) ? s : (list.find((f) => f.endsWith("Index.tsx")) ?? list[0] ?? null)));
    });
    void api.invoke("app:managed-files", appId).then(setManaged);
  }, [appId, refreshKey]);

  // A new file replaces the draft. A reload of the same file (after an AI turn) keeps unsaved edits.
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    api
      .invoke("app:read-file", appId, selected)
      .then((text) => {
        if (cancelled) return;
        setLoadError(null);
        if (loaded.current === selected && dirtyRef.current) {
          setContent((prev) => {
            if (prev !== text) setChangedOnDisk(true);
            return prev;
          });
          return;
        }
        loaded.current = selected;
        setContent(text);
        setDraft(text);
        setChangedOnDisk(false);
      })
      .catch((e) => {
        if (cancelled) return;
        loaded.current = selected;
        setLoadError(errorMessage(e));
        setContent("");
        setDraft("");
      });
    return () => {
      cancelled = true;
    };
  }, [appId, selected, refreshKey]);

  const choose = async (file: string) => {
    if (file === selected) return;
    if (dirty) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        body: `Your edits to ${selected} haven't been saved.`,
        confirmLabel: "Discard changes",
        danger: true,
      });
      if (!ok) {
        // The tree already moved its highlight; remount it on the open file.
        setTreeKey((k) => k + 1);
        return;
      }
    }
    setSelected(file);
  };

  const save = async () => {
    if (!selected || !dirty || saving) return;
    setSaving(true);
    try {
      await api.invoke("app:write-file", appId, selected, draft);
      setContent(draft);
      setChangedOnDisk(false);
      toast(`Saved ${selected}.`, "success");
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setSaving(false);
    }
  };

  const reloadFromDisk = () => {
    if (!selected) return;
    void api.invoke("app:read-file", appId, selected).then((text) => {
      setContent(text);
      setDraft(text);
      setChangedOnDisk(false);
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
      return;
    }
    if (e.key === "Escape") {
      tabEscapes.current = true;
      return;
    }
    if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !tabEscapes.current) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: start, selectionEnd: end } = el;
      const next = draft.slice(0, start) + EDITOR_INDENT + draft.slice(end);
      setDraft(next);
      requestAnimationFrame(() => el.setSelectionRange(start + EDITOR_INDENT.length, start + EDITOR_INDENT.length));
      return;
    }
    tabEscapes.current = false;
  };

  // The tree owns expansion and selection after it renders; rebuild it only when the file list changes.
  const tree = useMemo(() => buildTree(files, selected), [files]);
  const lineCount = useMemo(() => draft.split("\n").length, [draft]);
  const isManaged = selected !== null && managed.includes(selected);
  const isBinary = content.includes("\u0000");
  const readOnly = !selected || loadError !== null || isManaged || isBinary;

  return (
    <div className="code-view">
      {confirmNode}
      <div className="file-tree">
        <div className="side-head muted small">Files</div>
        <Tree key={`${files.join("|")}#${treeKey}`} label="Files" nodes={tree} value={selected} onSelect={(f) => void choose(f)} className="files" />
      </div>
      <div className="code-main">
        <div className="code-head">
          <Icon name="fileCode" size={14} />
          <span className="truncate">
            {selected ?? "No file selected"}
            {dirty && <span className="dirty-dot" aria-label="Unsaved changes" title="Unsaved changes" />}
          </span>
          {isManaged && <span className="muted small">Generated from the design system setup</span>}
          <div className="spacer" />
          {dirty && (
            <button className="sm ghost" disabled={saving} onClick={() => setDraft(content)}>
              Revert
            </button>
          )}
          <button
            className="sm ghost"
            disabled={!draft}
            onClick={() => navigator.clipboard.writeText(draft).then(() => toast("Copied to clipboard.", "success"))}
          >
            Copy
          </button>
          {!readOnly && (
            <Tooltip label={`Save (${navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+"}S)`}>
              <button className="sm primary" disabled={!dirty || saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </button>
            </Tooltip>
          )}
        </div>
        {changedOnDisk && (
          <Alert tone="warning">
            <div className="alert-row">
              <span>This file changed since you started editing. Saving replaces those changes with yours.</span>
              <button onClick={reloadFromDisk}>Discard my edits</button>
            </div>
          </Alert>
        )}
        <div className="code-editor">
          <div className="code-gutter" ref={gutterRef} aria-hidden="true">
            {Array.from({ length: lineCount }, (_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </div>
          <textarea
            className="code-input"
            aria-label={selected ? `Contents of ${selected}` : "File contents"}
            value={loadError ?? draft}
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            wrap="off"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onScroll={(e) => {
              if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
          />
        </div>
      </div>
    </div>
  );
}

function VersionsView({ appId, refreshKey, onRestored }: { appId: string; refreshKey: number; onRestored(): void }) {
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [confirmNode, confirm] = useConfirm();
  useEffect(() => {
    void api.invoke("app:versions", appId).then(setVersions);
  }, [appId, refreshKey]);

  return (
    <div className="page-scroll versions">
      <div>
        <h2>Version history</h2>
        <p className="muted small">Every AI turn is a git commit. Restoring creates a new version, so it can be undone too.</p>
      </div>
      {confirmNode}
      <ol className="timeline">
        {versions.map((v, i) => (
          <li key={v.hash} className={i === 0 ? "current" : undefined}>
            <span className="timeline-dot" />
            <div className="timeline-body">
              <div className="row">
                <strong className="grow">{v.message}</strong>
                {i === 0 ? (
                  <span className="meta-pill ok">Current</span>
                ) : (
                  <button
                    className="sm"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Restore ${v.hash.slice(0, 7)}?`,
                        body: `The app goes back to “${v.message}”. This is saved as a new version, so it can be undone.`,
                        confirmLabel: "Restore",
                      });
                      if (!ok) return;
                      api
                        .invoke("app:restore-version", appId, v.hash)
                        .then(() => {
                          toast("Version restored.", "success");
                          onRestored();
                        })
                        .catch((e) => toast(errorMessage(e), "danger"));
                    }}
                  >
                    <Icon name="history" size={13} />
                    Restore
                  </button>
                )}
              </div>
              <div className="muted small">
                <code>{v.hash.slice(0, 7)}</code> · {relativeTime(v.timestamp)} · {new Date(v.timestamp).toLocaleString()}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
