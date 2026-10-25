/**
 * Custom sandbox templates: a team's own starter app, imported from a local
 * folder or a git repository and kept as a snapshot. New apps copy the
 * snapshot, add the design system package, and get generated setup files.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FrameworkId } from "@shared/types";
import { FRAMEWORK_PACKAGE, type TemplateSource } from "@shared/templates";
import { ANGULAR_STYLES_FILE } from "../frameworks/angular";
import { kitFor } from "../frameworks";
import { runGit } from "../git";

export const TEMPLATE_MANIFEST = "atelier.template.json";
const IGNORED = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".output", ".angular", ".svelte-kit", "coverage", ".turbo", ".cache", ".vite"]);
const MAX_FILES = 5000;
const MAX_BYTES = 200 * 1024 * 1024;

export interface TemplateManifest {
  name?: string;
  description?: string;
  framework?: FrameworkId;
  devCommand?: string;
  setupFile?: string;
  rules?: string;
}

export interface Detected {
  name: string;
  description: string;
  framework: FrameworkId;
  stack: string;
  devCommand: string;
  setupFile: string;
  rules: string;
  warnings: string[];
}

/** Copies the source into `dest` (replacing it), leaving out dependencies, build output and git data. */
export async function snapshotSource(source: Exclude<TemplateSource, { kind: "builtin" }>, dest: string): Promise<void> {
  if (source.kind === "folder") {
    const from = path.resolve(source.path);
    if (!fs.existsSync(path.join(from, "package.json"))) throw new Error("The folder has no package.json. Pick the root of a starter app.");
    copyTree(from, dest);
    return;
  }
  validateGitUrl(source.url);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-template-"));
  try {
    // `--` keeps a URL that starts with "-" from being read as an option.
    await runGit(["clone", "--depth", "1", ...(source.ref ? ["--branch", source.ref] : []), "--", source.url, tmp], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    if (!fs.existsSync(path.join(tmp, "package.json"))) throw new Error("The repository has no package.json at its root.");
    copyTree(tmp, dest);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function validateGitUrl(url: string): void {
  if (!/^(https:\/\/[^\s]+|git@[\w.-]+:[^\s]+)$/.test(url.trim())) {
    throw new Error("Use an https:// or git@host:org/repo URL.");
  }
}

function copyTree(from: string, to: string): void {
  fs.rmSync(to, { recursive: true, force: true });
  let files = 0;
  let bytes = 0;
  const walk = (src: string, dst: string) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (IGNORED.has(entry.name) || entry.name === ".DS_Store") continue;
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      // Symlinks could point outside the template; they are skipped.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(s, d);
      else if (entry.isFile()) {
        files++;
        bytes += fs.statSync(s).size;
        if (files > MAX_FILES || bytes > MAX_BYTES) throw new Error("The template is too large (over 5000 files or 200 MB, without node_modules).");
        fs.copyFileSync(s, d);
      }
    }
  };
  walk(from, to);
}

type Pkg = { name?: string; description?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

/** Reads framework, stack and dev command from the snapshot; atelier.template.json wins. */
export function detectTemplate(dir: string): Detected {
  const pkg = readJson<Pkg>(path.join(dir, "package.json")) ?? {};
  const manifest = readJson<TemplateManifest>(path.join(dir, TEMPLATE_MANIFEST)) ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const warnings: string[] = [];

  let framework: FrameworkId | undefined = manifest.framework;
  if (!framework) {
    if (deps["@angular/core"]) framework = "angular";
    else if (deps.vue || deps.nuxt) framework = "vue";
    else if (deps.react || deps.next) framework = "react";
  }
  if (!framework) {
    throw new Error("Could not tell the framework: package.json lists none of react, vue or @angular/core. Add atelier.template.json with a framework.");
  }

  const { stack, command } = detectStack(deps, pkg.scripts ?? {}, dir);
  const setupFile = (manifest.setupFile ?? kitFor(framework).defaultSetupPath).replace(/^\.?\//, "");
  const detected: Detected = {
    name: manifest.name ?? pkg.name ?? path.basename(dir),
    description: manifest.description ?? pkg.description ?? "",
    framework,
    stack,
    devCommand: manifest.devCommand ?? command,
    setupFile,
    rules: manifest.rules ?? "",
    warnings,
  };
  detected.warnings.push(...checkWiring(dir, detected));
  return detected;
}

function detectStack(deps: Record<string, string>, scripts: Record<string, string>, dir: string): { stack: string; command: string } {
  if (deps.next) return { stack: "Next.js", command: "npx next dev -p {port} -H 127.0.0.1" };
  if (deps.nuxt) return { stack: "Nuxt", command: "npx nuxt dev --port {port} --host 127.0.0.1" };
  if (deps["@angular/core"] || fs.existsSync(path.join(dir, "angular.json"))) return { stack: "Angular CLI", command: "npx ng serve --port {port} --host 127.0.0.1" };
  if (deps.vite) return { stack: "Vite", command: "npx vite --port {port} --strictPort --host 127.0.0.1" };
  if (deps["react-scripts"]) return { stack: "Create React App", command: "BROWSER=none PORT={port} HOST=127.0.0.1 npx react-scripts start" };
  if (scripts.dev) return { stack: "Custom", command: "npm run dev -- --port {port}" };
  return { stack: "Custom", command: "npm start -- --port {port}" };
}

/** Problems that would stop the design system from loading in apps made from this template. */
export function checkWiring(dir: string, t: Pick<Detected, "framework" | "setupFile" | "devCommand">): string[] {
  const warnings: string[] = [];
  if (!t.devCommand.includes("{port}")) warnings.push("The dev command has no {port}, so the preview can't pick a free port.");
  const stem = path.basename(t.setupFile).replace(/\.[^.]+$/, "");
  const sources = listSources(dir);
  const imported = sources.some((f) => f !== t.setupFile && fs.readFileSync(path.join(dir, f), "utf8").includes(stem));
  if (!imported) {
    const how =
      t.framework === "react"
        ? "wrap the app root in its default export <DesignSystemRoot>"
        : t.framework === "vue"
          ? "call installDesignSystem(app) and render the app inside <DesignSystemRoot> in main.ts"
          : "add ...designSystemProviders to the app config providers";
    warnings.push(`Nothing imports ${t.setupFile} yet. In the template, ${how}, so the design system's styles and providers load.`);
  }
  if (t.framework === "angular") {
    const angularJson = path.join(dir, "angular.json");
    if (!fs.existsSync(angularJson) || !fs.readFileSync(angularJson, "utf8").includes(ANGULAR_STYLES_FILE)) {
      warnings.push(`Add "${ANGULAR_STYLES_FILE}" to the build "styles" in angular.json, so the design system's global styles load.`);
    }
  }
  return warnings;
}

/** The framework major a template's package.json asks for, such as 19 for "^19.2.0". */
export function frameworkMajorOf(dir: string, framework: FrameworkId): number | undefined {
  const pkg = readJson<Pkg>(path.join(dir, "package.json"));
  const pkgName = FRAMEWORK_PACKAGE[framework];
  const have = pkg?.dependencies?.[pkgName] ?? pkg?.devDependencies?.[pkgName];
  const major = have ? /(\d+)/.exec(have)?.[1] : undefined;
  return major ? Number(major) : undefined;
}

/**
 * Loads the generated design system files in an Angular template, so teams
 * don't have to edit their starter app first: adds the global stylesheet to
 * angular.json and `...designSystemProviders` to the root providers (an
 * `ApplicationConfig` or the bootstrapped NgModule). Leaves anything it can't
 * parse alone; checkWiring then explains what is missing. Returns what changed.
 */
export function wireAngularTemplate(dir: string, setupFile: string): string[] {
  const changes: string[] = [];
  if (addAngularStyles(dir)) changes.push(`Added ${ANGULAR_STYLES_FILE} to the build styles in angular.json.`);
  const root = addAngularProviders(dir, setupFile);
  if (root) changes.push(`Added ...designSystemProviders to the providers in ${root}.`);
  return changes;
}

function addAngularStyles(dir: string): boolean {
  const file = path.join(dir, "angular.json");
  const text = readText(file);
  if (text === undefined) return false;
  let json: { projects?: Record<string, { projectType?: string; architect?: AngularTargets; targets?: AngularTargets }> };
  try {
    json = JSON.parse(text);
  } catch {
    return false;
  }
  let changed = false;
  for (const project of Object.values(json.projects ?? {})) {
    if (project.projectType === "library") continue;
    const options = (project.architect ?? project.targets)?.build?.options;
    if (!options) continue;
    const styles = (options.styles ??= []);
    if (styles.some((s) => (typeof s === "string" ? s : s.input) === ANGULAR_STYLES_FILE)) continue;
    // First, so the app's own styles can override the design system's.
    styles.unshift(ANGULAR_STYLES_FILE);
    changed = true;
  }
  if (changed) {
    const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? 2;
    fs.writeFileSync(file, `${JSON.stringify(json, null, indent)}\n`);
  }
  return changed;
}

type AngularTargets = { build?: { options?: { styles?: (string | { input: string })[] } } };

/** Returns the patched file, relative to `dir`, or null. */
function addAngularProviders(dir: string, setupFile: string): string | null {
  const sources = listSources(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts") && f !== setupFile);
  const read = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");
  if (sources.some((f) => read(f).includes("designSystemProviders"))) return null;
  const rootModule = sources.find((f) => /@NgModule\s*\(/.test(read(f)) && /\bbootstrap\s*:/.test(read(f)));
  const appConfig = sources.find((f) => /\bApplicationConfig\b/.test(read(f)) && /\bproviders\s*:\s*\[/.test(read(f)));
  const target = rootModule ?? appConfig;
  if (!target) return null;

  let text = read(target);
  if (/\bproviders\s*:\s*\[/.test(text)) {
    text = text.replace(/\bproviders\s*:\s*\[(\s*)(\]?)/, (_, space: string, close: string) => (close ? "providers: [...designSystemProviders]" : `providers: [${space}...designSystemProviders,${space || " "}`));
  } else if (rootModule) {
    text = text.replace(/@NgModule\s*\(\s*\{/, "@NgModule({\n  providers: [...designSystemProviders],");
  } else {
    return null;
  }
  let spec = path.posix.relative(path.posix.dirname(target), setupFile.replace(/\.ts$/, ""));
  if (!spec.startsWith(".")) spec = `./${spec}`;
  fs.writeFileSync(path.join(dir, target), `import { designSystemProviders } from "${spec}";\n${text}`);
  return target;
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function listSources(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (IGNORED.has(entry.name)) continue;
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(r);
      else if (/\.(tsx?|jsx?|vue|mjs|html)$/.test(entry.name) && out.length < 3000) out.push(r);
    }
  };
  walk("");
  return out;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}
