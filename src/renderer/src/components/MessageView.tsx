import type { MessageRecord } from "@shared/types";
import { Icon, type IconName } from "../ui/icons";
import { Alert, Disclosure } from "../ui/slab";
import Markdown from "./Markdown";
import SelectionChip from "./SelectionChip";

type ActionKind = "write" | "rename" | "delete" | "add-dependency" | "command";
type Segment =
  | { kind: "text"; text: string }
  | { kind: "tool"; label: string; detail: string; error: boolean }
  | { kind: "action"; tag: ActionKind; label: string; detail?: string; body?: string; pending?: boolean };

const CLOSED = /<atelier-(write|rename|delete|add-dependency|command|chat-summary|tool)\b([^>]*)>([\s\S]*?)<\/atelier-\1>/g;
const OPEN = /<atelier-(write|rename|delete|add-dependency|command)\b([^>]*)>([\s\S]*)$/;

function attr(raw: string, name: string): string {
  return new RegExp(`${name}="([^"]*)"`).exec(raw)?.[1] ?? "";
}

function action(tag: string, attrs: string, body: string): Omit<Extract<Segment, { kind: "action" }>, "kind" | "pending"> | null {
  switch (tag) {
    case "write":
      return { tag, label: attr(attrs, "path"), detail: attr(attrs, "description") || undefined, body: body.replace(/^\n/, "") };
    case "rename":
      return { tag, label: `${attr(attrs, "from")} → ${attr(attrs, "to")}` };
    case "delete":
      return { tag, label: attr(attrs, "path") };
    case "add-dependency":
      return { tag, label: attr(attrs, "packages") || body.trim() };
    case "command":
      return { tag, label: attr(attrs, "type") };
    default:
      return null;
  }
}

/** Replaces action tags with compact cards, including a half-streamed trailing tag. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CLOSED)) {
    if (m.index! > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[1] === "tool") {
      // Written by Atelier when a connector tool runs, not by the model.
      out.push({ kind: "tool", label: attr(m[2], "name"), detail: m[3].trim(), error: attr(m[2], "status") === "error" });
      last = m.index! + m[0].length;
      continue;
    }
    const a = action(m[1], m[2], m[3]);
    if (a) out.push({ kind: "action", ...a });
    last = m.index! + m[0].length;
  }
  const rest = text.slice(last);
  const open = OPEN.exec(rest);
  if (open) {
    if (open.index > 0) out.push({ kind: "text", text: rest.slice(0, open.index) });
    const a = action(open[1], open[2], open[3]);
    if (a) out.push({ kind: "action", ...a, pending: true });
  } else if (rest) {
    // Hide a partially streamed opening tag such as "<atelier-wr".
    out.push({ kind: "text", text: stripPartialTag(rest) });
  }
  return out.filter((s) => s.kind !== "text" || s.text.trim());
}

function stripPartialTag(text: string): string {
  const i = text.lastIndexOf("<");
  if (i < 0) return text;
  const tail = text.slice(i);
  const prefix = "<atelier-";
  const partial = tail.length <= prefix.length ? prefix.startsWith(tail) : tail.startsWith(prefix) && !tail.includes(">");
  return partial ? text.slice(0, i) : text;
}

const ACTION_LOOK: Record<ActionKind, { icon: IconName; verb: string; pendingVerb: string; tone?: string }> = {
  write: { icon: "fileCode", verb: "Edited", pendingVerb: "Writing" },
  rename: { icon: "rename", verb: "Renamed", pendingVerb: "Renaming" },
  delete: { icon: "trash", verb: "Deleted", pendingVerb: "Deleting", tone: "danger" },
  "add-dependency": { icon: "package", verb: "Installed", pendingVerb: "Installing" },
  command: { icon: "terminal", verb: "Suggested", pendingVerb: "Suggesting" },
};

function ActionCard({ seg }: { seg: Extract<Segment, { kind: "action" }> }) {
  const look = ACTION_LOOK[seg.tag];
  const slash = seg.tag === "write" ? seg.label.lastIndexOf("/") : -1;
  const head = (
    <div className="action-head">
      <span className={`action-icon ${look.tone ?? ""}`}>
        <Icon name={look.icon} size={14} />
      </span>
      <span className="action-verb">{seg.pending ? look.pendingVerb : look.verb}</span>
      <span className="action-target truncate" title={seg.label}>
        {slash >= 0 ? (
          <>
            <strong>{seg.label.slice(slash + 1)}</strong>
            <span className="muted"> {seg.label.slice(0, slash)}</span>
          </>
        ) : (
          <strong>{seg.label}</strong>
        )}
      </span>
      {seg.pending && <span className="spinner" aria-hidden="true" />}
    </div>
  );
  if (seg.tag !== "write" || !seg.body) {
    return <div className={`action-card${seg.pending ? " pending" : ""}`}>{head}</div>;
  }
  const lines = seg.body.split("\n").length;
  return (
    <div className={`action-card${seg.pending ? " pending" : ""}`}>
      {head}
      {seg.detail && <div className="action-detail muted small">{seg.detail}</div>}
      <Disclosure label={seg.pending ? `${lines} lines so far` : `Show code · ${lines} lines`} className="action-code">
        <pre className="code-block">
          <code>{seg.body}</code>
        </pre>
      </Disclosure>
    </div>
  );
}

function ToolCard({ seg }: { seg: Extract<Segment, { kind: "tool" }> }) {
  return (
    <div className={`tool-card${seg.error ? " error" : ""}`}>
      <Icon name={seg.error ? "alert" : "plug"} size={13} />
      <span className="tool-card-label">{seg.label}</span>
      {seg.detail && (
        <span className="muted truncate" title={seg.detail}>
          {seg.detail}
        </span>
      )}
    </div>
  );
}

export function ThinkingDots({ label = "Thinking" }: { label?: string }) {
  return (
    <div className="thinking" role="status">
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {label}
    </div>
  );
}

export default function MessageView({
  message,
  streaming,
  onFixCompliance,
}: {
  message: MessageRecord;
  streaming?: boolean;
  onFixCompliance?(m: MessageRecord): void;
}) {
  if (message.role === "user") {
    return (
      <div className="msg user">
        {message.selection && <SelectionChip selection={message.selection} />}
        <div className="bubble">{message.content}</div>
      </div>
    );
  }
  const actions = message.actions;
  const segs = segments(message.content);
  const last = segs.at(-1);
  return (
    <div className="msg assistant">
      {segs.map((s, i) =>
        s.kind === "text" ? <Markdown key={i} text={s.text.trim()} /> : s.kind === "tool" ? <ToolCard key={i} seg={s} /> : <ActionCard key={i} seg={s} />,
      )}
      {streaming && (segs.length === 0 || last?.kind === "tool" || (last?.kind === "action" && !last.pending)) && (
        <ThinkingDots label={segs.length ? "Working" : "Thinking"} />
      )}
      {message.warnings?.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}
      {message.error && <Alert tone="danger">{message.error}</Alert>}
      {actions && actions.errors.length > 0 && (
        <Alert tone="danger">
          {actions.errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </Alert>
      )}
      {(actions?.commitHash || (message.compliance && message.compliance.length === 0 && actions && actions.written.length > 0)) && (
        <div className="msg-meta">
          {actions?.commitHash && (
            <span className="meta-pill">
              <Icon name="history" size={12} />
              Version {actions.commitHash.slice(0, 7)}
            </span>
          )}
          {message.compliance && message.compliance.length === 0 && actions && actions.written.length > 0 && (
            <span className="meta-pill ok">
              <Icon name="check" size={12} />
              Design system check passed
            </span>
          )}
        </div>
      )}
      {message.compliance && message.compliance.length > 0 && (
        <Alert tone="warning">
          <strong>Design system check: {message.compliance.length} issue(s)</strong>
          <ul>
            {message.compliance.slice(0, 8).map((c, i) => (
              <li key={i}>
                <code>
                  {c.file}:{c.line}
                </code>{" "}
                {c.message}
              </li>
            ))}
          </ul>
          {onFixCompliance && (
            <button className="sm" onClick={() => onFixCompliance(message)}>
              <Icon name="sparkles" size={14} />
              Fix with AI
            </button>
          )}
        </Alert>
      )}
    </div>
  );
}
