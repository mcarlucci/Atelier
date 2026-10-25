/**
 * Saving edits made directly in the preview: text changed inline and elements
 * moved among their siblings. A text edit whose old text appears exactly once
 * in the app's source is patched in place. Anything else (moves, and text that
 * can't be pinned to one place) is described for the model instead, since only
 * it can change JSX structure, loops and templates correctly.
 */
import fs from "node:fs";
import path from "node:path";
import type { PreviewEdit, PreviewSibling } from "@shared/types";
import { safeJoin } from "../chat/actions";
import { sanitizeSelection, selectionPrompt } from "./selection";

export const MAX_PREVIEW_EDITS = 50;
const MAX_TEXT = 2000;
const SOURCE_FILE = /\.(tsx|jsx|ts|js|mjs|vue|svelte|html)$/;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, max: number): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : -1);

function sibling(raw: unknown): PreviewSibling | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const tag = str(r.tag, 64).toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(tag)) return undefined;
  const classes = Array.isArray(r.classes) ? r.classes.filter((c) => typeof c === "string").slice(0, 6).map((c: string) => c.slice(0, 80)) : [];
  return { tag, classes, text: str(r.text, 80) };
}

/** Keeps well-formed edits at bounded sizes; edits come from the preview page. */
export function sanitizeEdits(raw: unknown, appDir: string): PreviewEdit[] {
  if (!Array.isArray(raw)) return [];
  const out: PreviewEdit[] = [];
  for (const item of raw.slice(0, MAX_PREVIEW_EDITS)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const element = sanitizeSelection(r.element, appDir);
    if (!element) continue;
    if (r.kind === "text") {
      const before = str(r.before, MAX_TEXT);
      const after = str(r.after, MAX_TEXT);
      if (before.trim() && before !== after) out.push({ kind: "text", element, before, after });
    } else if (r.kind === "move") {
      const parent = sanitizeSelection(r.parent, appDir);
      const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 200).map(sibling).filter((s): s is PreviewSibling => Boolean(s)) : []);
      const orderBefore = list(r.orderBefore);
      const orderAfter = list(r.orderAfter);
      const from = int(r.from, 199);
      const to = int(r.to, 199);
      if (parent && from >= 0 && to >= 0 && from !== to && orderBefore.length > Math.max(from, to)) {
        out.push({ kind: "move", element, parent, from, to, orderBefore, orderAfter });
      }
    }
  }
  return out;
}

/** Old text as a pattern that tolerates the whitespace JSX and templates collapse. */
function textPattern(text: string): RegExp {
  const escaped = text
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(escaped, "g");
}

/**
 * Whether `after` can replace the match without breaking the file: inside a
 * quoted string it can't contain that quote, a backslash or a newline; in JSX
 * or template text it can't contain braces or angle brackets.
 */
function safeReplacement(content: string, start: number, end: number, after: string): boolean {
  const open = content[start - 1];
  const close = content[end];
  if ((open === '"' || open === "'" || open === "`") && close === open) {
    return !after.includes(open) && !/[\\\n]/.test(after) && !(open === "`" && after.includes("${"));
  }
  return !/[{}<>]/.test(after);
}

/**
 * Patches every text edit in memory, or returns null as soon as one can't be
 * placed with certainty (not found, found more than once, or unsafe). Edits are
 * applied in order, so a second edit to the same text sees the first.
 */
export function planTextEdits(appDir: string, edits: PreviewEdit[], trackedFiles: string[], managedFiles: string[]): Map<string, string> | null {
  const managed = new Set(managedFiles);
  const sources = trackedFiles.filter((f) => SOURCE_FILE.test(f) && !managed.has(f));
  const contents = new Map<string, string>();
  const read = (rel: string) => {
    if (!contents.has(rel)) {
      try {
        contents.set(rel, fs.readFileSync(safeJoin(appDir, rel), "utf8"));
      } catch {
        contents.set(rel, "");
      }
    }
    return contents.get(rel)!;
  };
  const changed = new Set<string>();

  for (const e of edits) {
    if (e.kind !== "text" || e.before.trim().length < 2) return null;
    const after = e.after.trim();
    const find = (files: string[]) =>
      files.flatMap((rel) => [...read(rel).matchAll(textPattern(e.before))].map((m) => ({ rel, start: m.index!, end: m.index! + m[0].length })));
    // The owning component's file first, when the framework reported it.
    const own = e.element.file && sources.includes(e.element.file) ? find([e.element.file]) : [];
    const hits = own.length === 1 ? own : find(sources);
    if (hits.length !== 1) return null;
    const { rel, start, end } = hits[0];
    const content = read(rel);
    if (!safeReplacement(content, start, end, after)) return null;
    contents.set(rel, content.slice(0, start) + after + content.slice(end));
    changed.add(rel);
  }
  return new Map([...changed].map((rel) => [rel, contents.get(rel)!]));
}

export function writePlannedEdits(appDir: string, planned: Map<string, string>): string[] {
  for (const [rel, content] of planned) fs.writeFileSync(safeJoin(appDir, rel), content);
  return [...planned.keys()].map((rel) => rel.split(path.sep).join("/"));
}

const summary = (s: PreviewSibling) => `<${s.tag}${s.classes.length ? ` class="${s.classes.join(" ")}"` : ""}>${s.text ? ` ${JSON.stringify(s.text)}` : ""}`;

/** The chat prompt for edits that need the model. Page details are marked as data. */
export function editsPrompt(edits: PreviewEdit[]): string {
  const lines = [
    `Apply ${edits.length === 1 ? "this edit" : `these ${edits.length} edits`} I made directly in the live preview. Change the source so the app renders exactly this way, and keep everything else as it is.`,
    "",
  ];
  edits.forEach((e, i) => {
    if (e.kind === "text") {
      lines.push(`${i + 1}. Text change: ${JSON.stringify(e.before.trim())} → ${JSON.stringify(e.after.trim())}`, selectionPrompt(e.element), "");
    } else {
      lines.push(
        `${i + 1}. Move: the element below moved from position ${e.from + 1} to position ${e.to + 1} among the ${e.orderBefore.length} children of its parent.`,
        `Order before: ${e.orderBefore.map((s, n) => `${n + 1}) ${summary(s)}`).join("; ")}`,
        `Order after: ${e.orderAfter.map((s, n) => `${n + 1}) ${summary(s)}`).join("; ")}`,
        selectionPrompt(e.element),
        "Its parent:",
        selectionPrompt(e.parent),
        "",
      );
    }
  });
  return lines.join("\n").trim();
}
