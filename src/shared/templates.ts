/**
 * Sandbox templates: the starter app a design system's components render in.
 * A template targets one framework; a design system can use any template of
 * its framework. Built-in templates are generated; custom templates are
 * starter apps imported from a folder or git repository.
 */
import type { FrameworkId } from "./types";

export type TemplateSource = { kind: "builtin" } | { kind: "folder"; path: string } | { kind: "git"; url: string; ref?: string };

export interface TemplateInfo {
  id: string;
  name: string;
  framework: FrameworkId;
  /** Short stack label, e.g. "Vite" or "Angular CLI". */
  stack: string;
  description: string;
  source: TemplateSource;
  /** Starts the dev server; `{port}` is replaced with the preview port. */
  devCommand: string;
  /** Main generated design system setup file, relative to the app root. */
  setupFile: string;
  /** Extra instructions for the AI about this template's layout and conventions. */
  rules: string;
  /** Framework versions this template can be generated for, newest first (built-in only). */
  versions?: number[];
  /** Framework major in a custom template's package.json. */
  frameworkMajor?: number;
  importedAt?: number;
  warnings: string[];
}

export interface TemplateUpdate {
  name?: string;
  description?: string;
  framework?: FrameworkId;
  devCommand?: string;
  setupFile?: string;
  rules?: string;
}

export const FRAMEWORK_LABELS: Record<FrameworkId, string> = { react: "React", vue: "Vue", angular: "Angular" };

/** The package whose version a design system's peer range constrains, per framework. */
export const FRAMEWORK_PACKAGE: Record<FrameworkId, string> = { react: "react", vue: "vue", angular: "@angular/core" };

export const BUILTIN_TEMPLATE_IDS: Record<FrameworkId, string> = { react: "react-vite", vue: "vue-vite", angular: "angular-cli" };

export function isCompatible(template: Pick<TemplateInfo, "framework">, ds: { framework: FrameworkId }): boolean {
  return template.framework === ds.framework;
}

/** Why apps from a custom template may not work with the design system's framework range, or null. */
export function templateVersionProblem(
  t: Pick<TemplateInfo, "name" | "framework" | "frameworkMajor">,
  ds: { name: string; framework: FrameworkId; peerDependencies?: Record<string, string> },
): string | null {
  const wanted = ds.peerDependencies?.[FRAMEWORK_PACKAGE[t.framework]];
  if (t.frameworkMajor === undefined || !wanted || ds.framework !== t.framework) return null;
  if (pickMajor(wanted, [t.frameworkMajor]) !== undefined) return null;
  const label = FRAMEWORK_LABELS[t.framework];
  return `${ds.name} needs ${label} ${wanted}, but the “${t.name}” template uses ${label} ${t.frameworkMajor}. Apps made from it may fail to install or render.`;
}

/** The template a new app should use: the design system's default, else the first that fits. */
export function defaultTemplateFor(ds: { framework: FrameworkId; defaultTemplateId?: string }, templates: TemplateInfo[]): TemplateInfo | undefined {
  const fits = templates.filter((t) => isCompatible(t, ds));
  return fits.find((t) => t.id === ds.defaultTemplateId) ?? fits.find((t) => t.id === BUILTIN_TEMPLATE_IDS[ds.framework]) ?? fits[0];
}

/**
 * Picks the newest of `supported` majors that satisfies an npm range such as
 * "^18 || ^19", ">=17.0.0 <20" or "19.x". Unparseable or missing ranges allow
 * everything. Returns undefined when no supported major fits.
 */
export function pickMajor(range: string | undefined, supported: number[]): number | undefined {
  const sorted = [...supported].sort((a, b) => b - a);
  if (!range || !range.trim() || range.trim() === "*") return sorted[0];
  const allowed = new Set<number>();
  for (const part of range.split("||")) {
    let lo = -Infinity;
    let hi = Infinity;
    let parsed = false;
    for (const m of part.matchAll(/(>=|<=|>|<|\^|~|=)?\s*v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/g)) {
      const [, op = "", majorRaw, minorRaw] = m;
      if (majorRaw === "x" || majorRaw === "*") {
        parsed = true;
        continue;
      }
      const major = Number(majorRaw);
      const minor = minorRaw && /\d/.test(minorRaw) ? Number(minorRaw) : 0;
      parsed = true;
      if (op === ">=" || op === ">") lo = Math.max(lo, major);
      else if (op === "<") hi = Math.min(hi, minor > 0 || (m[4] && Number(m[4]) > 0) ? major : major - 1);
      else if (op === "<=") hi = Math.min(hi, major);
      else {
        lo = Math.max(lo, major);
        hi = Math.min(hi, major);
      }
    }
    if (!parsed) return sorted[0];
    for (const v of sorted) if (v >= lo && v <= hi) allowed.add(v);
  }
  return sorted.find((v) => allowed.has(v));
}
