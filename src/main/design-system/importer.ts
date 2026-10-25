import fs from "node:fs";
import path from "node:path";
import type {
  ComponentInfo,
  DesignSystem,
  DesignSystemManifestOverride,
  DesignSystemSetup,
  DesignSystemSource,
  FrameworkId,
} from "@shared/types";
import { NPM, run, runOrThrow } from "../process";
import { runtimeCommand, runtimeEnv, type NodeRuntime } from "../node/runtimes";
import { extractComponents, type EntryPoint, type ExtractResult } from "./extract";
import { setupPreset } from "./presets";

export const MANIFEST_FILE = "atelier.manifest.json";
const MAX_SUBPATH_ENTRIES = 150;
/** Wildcard subpaths such as `./*` can expand to hundreds of folders. */
const MAX_DEEP_ENTRIES = 400;
const FRAMEWORK_NAMES: Record<FrameworkId, string> = { react: "React", vue: "Vue", angular: "Angular" };
/** Package each framework's component types come from. npm skips it when the library doesn't list it as a peer. */
const FRAMEWORK_TYPES: Record<FrameworkId, string> = { react: "@types/react", vue: "vue", angular: "@angular/core" };
/** Entry points whose components are off until a team turns them on, such as `vuetify/labs/components`. */
const EXPERIMENTAL_PATH = /(^|\/)(labs?|experimental|unstable|internal|private|deprecated)(\/|$)/;

export interface ImportOptions {
  id: string;
  source: DesignSystemSource;
  /** Working directory for this design system's install (created if missing). */
  workDir: string;
  authToken?: string;
  framework?: FrameworkId;
  override?: DesignSystemManifestOverride;
  onLog?: (line: string) => void;
  /** Runs npm. Without one, the npm on PATH is used. */
  node?: NodeRuntime;
}

type PackageJson = {
  name: string;
  version: string;
  types?: string;
  typings?: string;
  main?: string;
  module?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/**
 * Installs a design system package into an isolated folder and builds its
 * catalog. Install scripts are disabled: the package is only read, never run.
 */
export async function importDesignSystem(opts: ImportOptions): Promise<DesignSystem> {
  const { workDir, source } = opts;
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(
    path.join(workDir, "package.json"),
    JSON.stringify({ name: "atelier-ds-workspace", private: true }, null, 2),
  );
  if (source.kind === "npm" && source.registry) {
    fs.writeFileSync(path.join(workDir, ".npmrc"), npmrcFor(source.registry, Boolean(opts.authToken)));
  }

  const spec = source.kind === "npm" ? source.spec : `file:${path.resolve(source.path)}`;
  const baseEnv = npmEnv(opts.authToken);
  const env = opts.node ? runtimeEnv(opts.node, baseEnv) : baseEnv;
  opts.onLog?.(`Installing ${spec}…`);
  await npmInstall(workDir, [spec], env, opts.onLog, opts.node);

  const installed = JSON.parse(fs.readFileSync(path.join(workDir, "package.json"), "utf8")) as PackageJson;
  const packageName = Object.keys(installed.dependencies ?? {})[0];
  if (!packageName) throw new Error(`npm did not record a dependency for ${spec}`);
  const pkgDir = path.join(workDir, "node_modules", packageName);
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) as PackageJson;

  const fileOverride = readJson<DesignSystemManifestOverride>(path.join(pkgDir, MANIFEST_FILE));
  const override = mergeOverrides(fileOverride, opts.override);
  const forced = opts.framework ?? override.framework;
  const detected = forced ?? detectFramework(pkg);
  // Without a framework in the package's dependencies (PrimeVue lists none), try each one.
  const frameworks: FrameworkId[] = forced ? [forced] : detected ? [detected] : ["vue", "angular", "react"];

  const ensureTypes = async (framework: FrameworkId) => {
    const typesPkg = FRAMEWORK_TYPES[framework];
    if (fs.existsSync(path.join(workDir, "node_modules", typesPkg, "package.json"))) return;
    opts.onLog?.(`Installing ${typesPkg} to read ${FRAMEWORK_NAMES[framework]} component types…`);
    try {
      await npmInstall(workDir, [typesPkg], env, opts.onLog, opts.node);
    } catch (e) {
      opts.onLog?.(`Could not install ${typesPkg}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const found = await findComponents(pkgDir, pkg, frameworks, ensureTypes, opts.onLog);
  if (!found.framework) throw new Error(noComponentsMessage(pkg, frameworks, found.entries, Boolean(forced)));
  const { framework, extracted } = found;
  opts.onLog?.(`Found ${extracted.components.length} ${FRAMEWORK_NAMES[framework]} components.`);

  const warnings: string[] = [...extracted.warnings];
  const experimental = extracted.components.filter((c) => EXPERIMENTAL_PATH.test(c.importPath.slice(pkg.name.length)));
  if (experimental.length) {
    const paths = [...new Set(experimental.map((c) => c.importPath))];
    warnings.push(
      `${experimental.length} component(s) from experimental entry points (${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ", …" : ""}) are turned off. Turn them on under Components.`,
    );
  }

  const preset = setupPreset(framework, pkg.name, pkg.version);
  if (preset && !override.setup?.angularProviders && !override.setup?.vuePlugin) {
    warnings.push(`Set up as ${preset.label}. Change this under Setup if it is wrong.`);
  }
  const detectedCss = detectCss(pkgDir, pkg);
  const globalCss = override.setup?.globalCss?.length
    ? override.setup.globalCss
    : (preset?.setup.globalCss ?? detectedCss);
  // A preset that sets no stylesheet themes the components from JavaScript (PrimeVue).
  if (globalCss.length === 0 && framework !== "angular" && !preset) {
    warnings.push("No global stylesheet was found. Add one under Setup if the components need it.");
  }
  const provider = override.setup?.provider ?? preset?.setup.provider ?? detectProvider(extracted.components, pkg.name);
  if (provider) warnings.push(`Wrapping apps in <${provider.importName}>. Change this under Setup if it is wrong.`);

  const discovered = extracted.components.map((c) => (experimental.includes(c) ? { ...c, enabled: false } : c));
  const components = applyComponentOverrides(discovered, override);
  const setup: DesignSystemSetup = {
    globalCss,
    provider,
    // Merged, so a re-import adds packages a newer preset needs.
    extraDependencies: { ...preset?.setup.extraDependencies, ...override.setup?.extraDependencies },
    angularModules: override.setup?.angularModules,
    angularProviders: override.setup?.angularProviders ?? preset?.setup.angularProviders,
    vuePlugin: framework === "vue" ? (override.setup?.vuePlugin ?? preset?.setup.vuePlugin) : undefined,
  };

  return {
    id: opts.id,
    name: override.name ?? pkg.name,
    framework,
    packageName: pkg.name,
    version: pkg.version,
    source,
    dependencySpec: source.kind === "npm" ? `^${pkg.version}` : `file:${path.resolve(source.path)}`,
    setup,
    components,
    guidelines: override.guidelines ?? "",
    tokens: override.tokens ?? collectTokens(pkgDir, globalCss, pkg.name),
    importedAt: Date.now(),
    warnings,
    hasAuthToken: Boolean(opts.authToken),
    peerDependencies: pkg.peerDependencies ?? {},
  };
}

/**
 * Reads the package's declarations for components. The exported entry points
 * come first; when they hold no components, wildcard subpaths such as
 * `./components/*` are expanded and read too.
 */
async function findComponents(
  pkgDir: string,
  pkg: PackageJson,
  frameworks: FrameworkId[],
  ensureTypes: (framework: FrameworkId) => Promise<void>,
  onLog?: (line: string) => void,
): Promise<{ framework: FrameworkId; extracted: ExtractResult; entries: EntryPoint[] } | { framework?: undefined; entries: EntryPoint[] }> {
  const shallow = findEntryPoints(pkgDir, pkg);
  const deep = findEntryPoints(pkgDir, pkg, { deep: true });
  const passes = deep.length > shallow.length ? [shallow, deep] : [shallow];
  let read: EntryPoint[] = shallow;
  for (const entries of passes) {
    if (entries.length === 0) continue;
    read = entries;
    for (const framework of frameworks) {
      await ensureTypes(framework);
      onLog?.(`Reading ${entries.length} declaration file(s) for ${FRAMEWORK_NAMES[framework]} components…`);
      const extracted = extractComponents(entries, framework);
      if (extracted.components.length > 0) return { framework, extracted, entries };
    }
  }
  return { entries: read };
}

export function noComponentsMessage(pkg: PackageJson, frameworks: FrameworkId[], entries: EntryPoint[], forced: boolean): string {
  const where = `${pkg.name}@${pkg.version}`;
  if (entries.length === 0) {
    return `${where} does not publish TypeScript declarations (.d.ts files), which Atelier reads to find components. Import the package that ships them, or build the library first if this is a local folder.`;
  }
  const kinds = frameworks.map((f) => FRAMEWORK_NAMES[f]).join(", ").replace(/, ([^,]*)$/, " or $1");
  const shown = entries.slice(0, 6).map((e) => e.importPath);
  return [
    `No ${kinds} components were found in ${where}.`,
    `Read ${entries.length} declaration file(s): ${shown.join(", ")}${entries.length > shown.length ? ", …" : ""}.`,
    forced
      ? `If ${pkg.name} is not a ${kinds} library, set Framework to "Detect automatically" and import again.`
      : `If the components are published in a separate package (for example "${pkg.name}-vue" or "@scope/components"), import that package instead.`,
  ].join("\n");
}

/** `.npmrc` that reads the token from the environment, so it is never written to disk. */
export function npmrcFor(registry: string, withToken: boolean): string {
  const url = new URL(registry);
  const lines = [`registry=${url.href}`];
  if (withToken) lines.push(`//${url.host}${url.pathname}:_authToken=\${ATELIER_NPM_TOKEN}`);
  return `${lines.join("\n")}\n`;
}

export function npmEnv(authToken?: string): NodeJS.ProcessEnv {
  return { ...process.env, ATELIER_NPM_TOKEN: authToken ?? "" };
}

async function npmInstall(
  cwd: string,
  specs: string[],
  env: NodeJS.ProcessEnv,
  onLog?: (line: string) => void,
  node?: NodeRuntime,
): Promise<void> {
  const base = ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...specs];
  const npm = (args: string[]) => (node ? runtimeCommand(node, "npm", args) : { command: NPM, args });
  const log = (_: string, text: string) => onLog?.(text);
  const first = await run(npm(base).command, npm(base).args, { cwd, env, onOutput: log });
  if (first.code === 0) return;
  if (/ERESOLVE/.test(first.stderr)) {
    onLog?.("Peer dependency conflict; retrying with --legacy-peer-deps");
    const retry = npm([...base, "--legacy-peer-deps"]);
    await runOrThrow(retry.command, retry.args, { cwd, env, onOutput: log });
    return;
  }
  const tail = first.stderr.trim().split("\n").slice(-12).join("\n");
  throw new Error(`npm install ${specs.join(" ")} failed:\n${tail}`);
}

export function detectFramework(pkg: PackageJson): FrameworkId | null {
  const deps = { ...pkg.dependencies, ...pkg.peerDependencies };
  if (deps["@angular/core"]) return "angular";
  if (deps.vue || deps["vue-demi"] || deps["@vue/runtime-core"]) return "vue";
  if (deps.react || deps["react-dom"]) return "react";
  return null;
}

/**
 * Root declarations plus typed subpath exports such as `@acme/ui/button`. A
 * subpath that points at JavaScript (`"./components": "./lib/components/index.js"`,
 * as Vuetify publishes) is read from the declaration file next to it. With
 * `deep`, wildcard subpaths are expanded from the package's folders.
 */
export function findEntryPoints(pkgDir: string, pkg: PackageJson, opts: { deep?: boolean } = {}): EntryPoint[] {
  const entries: (EntryPoint & { rank: number })[] = [];
  const add = (rel: string | undefined, importPath: string, rank: number) => {
    if (!rel || rel.includes("*")) return;
    const file = declarationFor(path.resolve(pkgDir, rel));
    if (file && !entries.some((e) => e.file === file)) entries.push({ file, importPath, rank });
  };
  const subpath = (key: string) => `${pkg.name}/${key.replace(/^\.\//, "")}`;
  // Bundles and file paths (`vuetify/dist/vuetify.js`) are a last resort for import paths.
  const rankOf = (key: string, wildcard: boolean) => (/(^|\/)dist\/|\.(m|c)?js$/.test(key) ? 3 : wildcard ? 2 : 1);

  const exportsField = pkg.exports;
  if (exportsField && typeof exportsField === "object" && !Array.isArray(exportsField)) {
    const map = exportsField as Record<string, unknown>;
    const isSubpathMap = Object.keys(map).some((k) => k.startsWith("."));
    if (isSubpathMap) {
      add(typesTarget(map["."]), pkg.name, 0);
      for (const [key, value] of Object.entries(map)) {
        if (key === "." || key.endsWith(".css") || key === "./package.json") continue;
        if (!key.includes("*")) {
          add(typesTarget(value), subpath(key), rankOf(key, false));
        } else if (opts.deep) {
          for (const match of expandWildcard(pkgDir, key, typesTarget(value))) {
            add(match.target, subpath(match.key), rankOf(match.key, true));
          }
        }
      }
    } else {
      add(typesTarget(map), pkg.name, 0);
    }
  }
  if (!entries.some((e) => e.importPath === pkg.name)) {
    add(pkg.types ?? pkg.typings, pkg.name, 0);
    for (const candidate of [pkg.module, pkg.main, "index.js"]) add(candidate, pkg.name, 0);
  }
  // Root barrel first so its import path wins, then named subpaths, then expanded wildcards.
  return entries
    .sort((a, b) => a.rank - b.rank)
    .slice(0, opts.deep ? MAX_DEEP_ENTRIES : MAX_SUBPATH_ENTRIES)
    .map(({ file, importPath }) => ({ file, importPath }));
}

/** The declaration file for an export target: itself, or the `.d.ts` beside a `.js` file or inside a folder. */
function declarationFor(file: string): string | null {
  const candidates = /\.d\.(m|c)?ts$/.test(file) || /\.tsx?$/.test(file)
    ? [file]
    : /\.(m|c)?js$/.test(file)
      ? [".d.ts", ".d.mts", ".d.cts"].map((ext) => file.replace(/\.(m|c)?js$/, ext))
      : path.extname(file)
        ? []
        : [`${file}.d.ts`, path.join(file, "index.d.ts")];
  return candidates.find((c) => fs.statSync(c, { throwIfNoEntry: false })?.isFile()) ?? null;
}

/** The `types` target of an export, else its JavaScript target (whose declarations sit beside it). */
function typesTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(typesTarget).find(Boolean);
  if (!value || typeof value !== "object") return undefined;
  const conditions = value as Record<string, unknown>;
  for (const key of ["types", "import", "module", "browser", "default", "require", "node"]) {
    const nested = typesTarget(conditions[key]);
    if (nested) return nested;
  }
  return undefined;
}

/** `./components/*` with target `./lib/components/*\/index.js` -> one match per folder in lib/components. */
function expandWildcard(pkgDir: string, key: string, target: string | undefined): { key: string; target: string }[] {
  if (!target) return [];
  const keyParts = key.split("*");
  const targetParts = target.split("*");
  if (keyParts.length !== 2 || targetParts.length !== 2) return [];
  const [targetBefore, targetAfter] = targetParts;
  const slash = targetBefore.lastIndexOf("/");
  const dir = path.resolve(pkgDir, targetBefore.slice(0, slash + 1));
  const prefix = targetBefore.slice(slash + 1);
  let names: string[];
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
  const out: { key: string; target: string }[] = [];
  for (const name of names) {
    if (!name.startsWith(prefix) || /^[._]/.test(name) || name === "node_modules") continue;
    let stem = name.slice(prefix.length);
    if (targetAfter && !targetAfter.startsWith("/")) {
      // `./*.js`: the folder entry carries the suffix.
      if (!stem.endsWith(targetAfter)) continue;
      stem = stem.slice(0, -targetAfter.length);
    }
    if (!stem || stem.endsWith(".map")) continue;
    out.push({ key: `${keyParts[0]}${stem}${keyParts[1]}`, target: `${targetBefore}${stem}${targetAfter}` });
  }
  return out;
}

export function detectCss(pkgDir: string, pkg: PackageJson): string[] {
  const exported: string[] = [];
  if (pkg.exports && typeof pkg.exports === "object" && !Array.isArray(pkg.exports)) {
    for (const [key, value] of Object.entries(pkg.exports as Record<string, unknown>)) {
      if (key === "." || !key.startsWith("./") || key.includes("*")) continue;
      // `./styles.css`, or `./styles` whose target is a stylesheet (Vuetify).
      if (key.endsWith(".css") || cssTarget(value)) exported.push(`${pkg.name}/${key.slice(2)}`);
    }
  }
  const preferred = (p: string) => /(^|\/)(styles?|index|main|theme|tokens|globals?)(\.css)?$/.test(p);
  if (exported.length) return [exported.find(preferred) ?? exported[0]];

  for (const dir of ["", "dist", "lib", "build", "css", "styles", "dist/css"]) {
    const abs = path.join(pkgDir, dir);
    if (!fs.existsSync(abs)) continue;
    const css = fs.readdirSync(abs).filter((f) => f.endsWith(".css") && !f.endsWith(".min.css"));
    const hit = css.find((f) => preferred(f)) ?? (css.length === 1 ? css[0] : undefined);
    if (hit) return [`${pkg.name}/${dir ? `${dir}/` : ""}${hit}`];
  }
  return [];
}

/** The stylesheet an export resolves to, if it resolves to one. */
function cssTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value.endsWith(".css") ? value : undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const conditions = value as Record<string, unknown>;
  for (const key of ["style", "import", "default", "require"]) {
    const nested = cssTarget(conditions[key]);
    if (nested) return nested;
  }
  return undefined;
}

function detectProvider(components: ComponentInfo[], packageName: string): DesignSystemSetup["provider"] {
  // `@mantine/core` -> MantineProvider, `@acme/ui` -> AcmeProvider.
  const brand = (packageName.startsWith("@") ? packageName.slice(1).split("/")[0] : packageName).replace(/[^a-z0-9]/gi, "").toLowerCase();
  const match =
    components.find((c) => c.name === "Theme" || c.name === "ThemeProvider") ??
    components.find((c) => c.name.toLowerCase() === `${brand}provider`) ??
    components.find((c) => /^(DesignSystem|Ui|UI)?Provider$|^\w*ThemeProvider$/.test(c.name));
  return match && !match.defaultExport ? { importName: match.name, importPath: match.importPath } : undefined;
}

/** CSS custom property names from the global stylesheet, for custom layout work. */
export function collectTokens(pkgDir: string, globalCss: string[], packageName: string): string[] {
  const tokens = new Set<string>();
  for (const spec of globalCss) {
    if (!spec.startsWith(`${packageName}/`)) continue;
    const file = resolveExportedFile(pkgDir, spec.slice(packageName.length + 1));
    if (!file) continue;
    const css = fs.readFileSync(file, "utf8");
    for (const match of css.matchAll(/(--[a-zA-Z0-9-_]+)\s*:/g)) {
      tokens.add(match[1]);
      if (tokens.size >= 400) break;
    }
  }
  return [...tokens];
}

function resolveExportedFile(pkgDir: string, subpath: string): string | null {
  const direct = path.join(pkgDir, subpath);
  if (fs.existsSync(direct)) return direct;
  const pkg = readJson<PackageJson>(path.join(pkgDir, "package.json"));
  const target = (pkg?.exports as Record<string, unknown> | undefined)?.[`./${subpath}`];
  const rel = cssTarget(target);
  return rel && fs.existsSync(path.join(pkgDir, rel)) ? path.join(pkgDir, rel) : null;
}

function applyComponentOverrides(
  components: ComponentInfo[],
  override: DesignSystemManifestOverride,
): ComponentInfo[] {
  const extra = override.components ?? {};
  return components.map((c) => {
    const o = extra[c.name];
    if (!o) return c;
    return {
      ...c,
      description: o.description ?? c.description,
      examples: o.examples ?? c.examples,
      enabled: o.enabled ?? c.enabled,
    };
  });
}

function mergeOverrides(
  a: DesignSystemManifestOverride | null,
  b: DesignSystemManifestOverride | undefined,
): DesignSystemManifestOverride {
  const base = a ?? {};
  const top = b ?? {};
  return {
    ...base,
    ...top,
    setup: base.setup || top.setup ? { ...base.setup, ...top.setup } : undefined,
    components: { ...base.components, ...top.components },
  };
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}
