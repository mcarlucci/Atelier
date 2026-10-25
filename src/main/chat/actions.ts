import fs from "node:fs";
import path from "node:path";
import { OMITTED_FILE_NOTE } from "./prompt";

export type Action =
  | { type: "write"; path: string; content: string; description?: string }
  | { type: "rename"; from: string; to: string }
  | { type: "delete"; path: string }
  | { type: "add-dependency"; packages: string[] }
  | { type: "command"; command: string };

export interface ParsedResponse {
  actions: Action[];
  summary?: string;
}

const TAG = /<atelier-(write|rename|delete|add-dependency|command|chat-summary)\b([^>]*)>([\s\S]*?)<\/atelier-\1>/g;
const ATTR = /([\w-]+)="([^"]*)"/g;

export function parseResponse(text: string): ParsedResponse {
  const actions: Action[] = [];
  let summary: string | undefined;
  for (const match of text.matchAll(TAG)) {
    const [, tag, rawAttrs, body] = match;
    const attrs = Object.fromEntries([...rawAttrs.matchAll(ATTR)].map((m) => [m[1], decodeEntities(m[2])]));
    switch (tag) {
      case "write":
        if (attrs.path) actions.push({ type: "write", path: attrs.path, content: cleanBody(body), description: attrs.description });
        break;
      case "rename":
        if (attrs.from && attrs.to) actions.push({ type: "rename", from: attrs.from, to: attrs.to });
        break;
      case "delete":
        if (attrs.path) actions.push({ type: "delete", path: attrs.path });
        break;
      case "add-dependency": {
        const packages = (attrs.packages ?? body).split(/[\s,]+/).filter(Boolean);
        if (packages.length) actions.push({ type: "add-dependency", packages });
        break;
      }
      case "command":
        if (attrs.type) actions.push({ type: "command", command: attrs.type });
        break;
      case "chat-summary":
        summary = body.trim() || undefined;
        break;
    }
  }
  return { actions, summary };
}

/** Removes one leading/trailing newline and a stray markdown fence around the whole body. */
function cleanBody(body: string): string {
  let out = body.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  const fenced = /^```[\w-]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(out);
  if (fenced) out = fenced[1];
  return out.endsWith("\n") ? out : `${out}\n`;
}

function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Strips file bodies from earlier assistant turns; the snapshot carries current contents. */
export function elideFileBodies(text: string): string {
  return text.replace(
    /(<atelier-write\b[^>]*>)[\s\S]*?(<\/atelier-write>)/g,
    (_m, open: string, close: string) => `${open}${OMITTED_FILE_NOTE}${close}`,
  );
}

const PACKAGE_SPEC = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~<>=*|-]+)?$/i;
const PROTECTED = [/^\.git(\/|$)/, /^node_modules(\/|$)/, /^\.npmrc$/];

/** Resolves a model-supplied path inside the app, rejecting anything that escapes it. */
export function safeJoin(root: string, rel: string): string {
  const normalized = rel.replace(/\\/g, "/").replace(/^\.\//, "");
  if (path.isAbsolute(normalized) || PROTECTED.some((re) => re.test(normalized))) {
    throw new Error(`Refusing to touch ${rel}`);
  }
  const abs = path.resolve(root, normalized);
  const rootWithSep = path.resolve(root) + path.sep;
  if (!abs.startsWith(rootWithSep)) throw new Error(`Path escapes the app folder: ${rel}`);
  return abs;
}

export function isValidPackageSpec(spec: string): boolean {
  return PACKAGE_SPEC.test(spec) && !spec.startsWith("-");
}

export interface ApplyResult {
  written: string[];
  renamed: { from: string; to: string }[];
  deleted: string[];
  dependencies: string[];
  commands: string[];
  errors: string[];
}

/**
 * Applies file actions in a fixed order: renames, deletes, then writes, so a
 * reply that renames a file and then rewrites it lands correctly. Dependency
 * installs are returned for the caller to run.
 */
export function applyFileActions(root: string, actions: Action[], managedFiles: string[]): ApplyResult {
  const result: ApplyResult = { written: [], renamed: [], deleted: [], dependencies: [], commands: [], errors: [] };
  const managed = new Set(managedFiles);
  const guard = (rel: string) => {
    if (managed.has(rel.replace(/^\.\//, ""))) throw new Error(`${rel} is generated from the design system setup and was not changed`);
  };
  const ordered = [
    ...actions.filter((a) => a.type === "rename"),
    ...actions.filter((a) => a.type === "delete"),
    ...actions.filter((a) => a.type === "write"),
    ...actions.filter((a) => a.type === "add-dependency" || a.type === "command"),
  ];
  for (const action of ordered) {
    try {
      switch (action.type) {
        case "rename": {
          guard(action.from);
          guard(action.to);
          const from = safeJoin(root, action.from);
          const to = safeJoin(root, action.to);
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.renameSync(from, to);
          result.renamed.push({ from: action.from, to: action.to });
          break;
        }
        case "delete":
          guard(action.path);
          fs.rmSync(safeJoin(root, action.path), { force: true, recursive: true });
          result.deleted.push(action.path);
          break;
        case "write": {
          guard(action.path);
          const abs = safeJoin(root, action.path);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, action.content);
          result.written.push(action.path);
          break;
        }
        case "add-dependency":
          for (const spec of action.packages) {
            if (isValidPackageSpec(spec)) result.dependencies.push(spec);
            else result.errors.push(`Skipped invalid package name: ${spec}`);
          }
          break;
        case "command":
          result.commands.push(action.command);
          break;
      }
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return result;
}
