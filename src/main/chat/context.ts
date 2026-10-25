import fs from "node:fs";
import path from "node:path";
import { gitTrackedFiles } from "../git";

const MAX_FILE_BYTES = 120_000;
const MAX_TOTAL_BYTES = 1_500_000;
const SKIP = [/(^|\/)package-lock\.json$/, /(^|\/)pnpm-lock\.yaml$/, /(^|\/)yarn\.lock$/, /^AI_RULES\.md$/, /(^|\/)\.npmrc$/];
const TEXT_EXT = /\.(tsx?|jsx?|mjs|cjs|vue|html|css|scss|less|json|md|svg|txt|ya?ml)$/i;

export interface CodebaseSnapshot {
  text: string;
  files: string[];
  omitted: string[];
}

/** Serializes the app's source files for the model, so each turn sends the whole codebase. */
export async function snapshotCodebase(appDir: string): Promise<CodebaseSnapshot> {
  const all = await gitTrackedFiles(appDir);
  const files: string[] = [];
  const omitted: string[] = [];
  const parts: string[] = [];
  let total = 0;
  for (const rel of all) {
    if (SKIP.some((re) => re.test(rel)) || !TEXT_EXT.test(rel)) continue;
    const abs = path.join(appDir, rel);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_BYTES || total + stat.size > MAX_TOTAL_BYTES) {
      omitted.push(rel);
      continue;
    }
    total += stat.size;
    files.push(rel);
    parts.push(`<atelier-file path="${rel}">\n${fs.readFileSync(abs, "utf8")}\n</atelier-file>`);
  }
  if (omitted.length) parts.push(`Files omitted for size: ${omitted.join(", ")}`);
  return { text: parts.join("\n\n"), files, omitted };
}

export function readAppNotes(appDir: string): string {
  try {
    return fs.readFileSync(path.join(appDir, "AI_RULES.md"), "utf8").trim();
  } catch {
    return "";
  }
}
