/**
 * Turns a template record into what the rest of Atelier needs: scaffolding a
 * new app, the generated setup files, the AI's stack rules, and the dev server
 * command.
 */
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import type { DesignSystem } from "@shared/types";
import { FRAMEWORK_LABELS, FRAMEWORK_PACKAGE, pickMajor, templateVersionProblem, type TemplateInfo } from "@shared/templates";
import { kitFor } from "../frameworks";
import type { FrameworkKit } from "../frameworks/types";
import { BUILTIN_TEMPLATES, slug } from "./builtin";
import { frameworkMajorOf, wireAngularTemplate } from "./custom";

export interface TemplateRuntime {
  info: TemplateInfo;
  kit: FrameworkKit;
  /**
   * Writes a new app into an empty folder. With `nodeVersion` (the Node.js on
   * PATH that will run the dev server), built-in templates only pick framework
   * versions whose toolchain runs on it. Returns warnings for the user.
   */
  scaffold(appDir: string, ds: DesignSystem, appName: string, opts?: { nodeVersion?: string }): string[];
  /** Generated design system setup files, keyed by path. */
  setupFiles(ds: DesignSystem): Record<string, string>;
  stackRules(ds: DesignSystem): string;
  /** Program names (`npm`, `npx`) are left as written; the runner resolves them to the app's Node.js. */
  devCommand(port: number): DevCommand;
  /** Node.js ranges the app in `appDir` needs, all of which must hold. */
  nodeRanges(appDir: string): string[];
}

export interface DevCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function builtinTemplateInfos(): TemplateInfo[] {
  return BUILTIN_TEMPLATES.map((t) => t.info);
}

/** `snapshotDir` holds a custom template's files; built-in templates generate theirs. */
export function runtimeFor(info: TemplateInfo, snapshotDir?: string): TemplateRuntime {
  const kit = kitFor(info.framework);
  const builtin = BUILTIN_TEMPLATES.find((t) => t.info.id === info.id && info.source.kind === "builtin");
  const setupFiles = (ds: DesignSystem) => kit.setupFiles(ds, info.setupFile);

  return {
    info,
    kit,
    setupFiles,

    scaffold(appDir, ds, appName, opts = {}) {
      const warnings: string[] = [];
      let files: Record<string, string>;
      if (builtin) {
        const pkgName = FRAMEWORK_PACKAGE[info.framework];
        const range = ds.peerDependencies?.[pkgName];
        const label = FRAMEWORK_LABELS[info.framework];
        const all = info.versions ?? [];
        const node = opts.nodeVersion ? semver.coerce(opts.nodeVersion)?.version : undefined;
        const runnable = node ? all.filter((m) => semver.satisfies(node, builtin.node(m))) : all;
        let major = pickMajor(range, runnable);
        if (major === undefined) {
          const forDs = pickMajor(range, all);
          if (forDs !== undefined && node) {
            major = forDs;
            warnings.push(`${label} ${forDs} needs Node.js ${builtin.node(forDs)}, but this computer has ${node}. Update Node.js, or the preview won't start.`);
          } else {
            major = runnable[0] ?? all[0];
            warnings.push(`${ds.name} expects ${pkgName} ${range}, which ${info.name} can't generate. Using ${label} ${major}; components may not render correctly.`);
          }
        }
        files = builtin.files(ds, appName, major);
      } else {
        if (!snapshotDir || !fs.existsSync(snapshotDir)) throw new Error(`The files for the “${info.name}” template are missing. Refresh it from its source.`);
        fs.cpSync(snapshotDir, appDir, { recursive: true });
        files = {};
        const pkgFile = path.join(appDir, "package.json");
        const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8")) as { name?: string; dependencies?: Record<string, string> };
        pkg.name = slug(appName);
        pkg.dependencies = { ...pkg.dependencies, [ds.packageName]: ds.dependencySpec, ...ds.setup.extraDependencies };
        files["package.json"] = `${JSON.stringify(pkg, null, 2)}\n`;
        if (!fs.existsSync(path.join(appDir, "AI_RULES.md"))) {
          files["AI_RULES.md"] = "# App notes\n\nAdd product context, naming, and constraints for this app here. They are sent with every request.\n";
        }
        if (!fs.existsSync(path.join(appDir, ".gitignore"))) files[".gitignore"] = "node_modules\ndist\n*.log\n.DS_Store\n";
        const w = templateVersionProblem({ ...info, frameworkMajor: frameworkMajorOf(snapshotDir, info.framework) }, ds);
        if (w) warnings.push(w);
        // Templates imported before Atelier wired them get wired in each new app instead.
        if (info.framework === "angular") wireAngularTemplate(appDir, info.setupFile);
      }
      for (const [rel, content] of Object.entries({ ...files, ...setupFiles(ds) })) writeFile(appDir, rel, content);
      return warnings;
    },

    stackRules(ds) {
      const base = builtin
        ? builtin.rules(ds)
        : `# Stack
- ${FRAMEWORK_LABELS[info.framework]} app made from the team's “${info.name}” template (${info.stack}). Follow the conventions already in the codebase: put new pages and components where similar ones live, and register routes the way existing routes are registered.
- When you add a component, also render it from a page, or the user cannot see it.`;
      const extra = info.rules.trim() ? `\n\n# Template notes from the team\n${info.rules.trim()}` : "";
      return `${base}\n${kit.setupRules(ds, info.setupFile)}${extra}`;
    },

    devCommand: (port) => parseCommand(info.devCommand, port, kit.env ?? {}),

    nodeRanges(appDir) {
      const pkg = readJson<{ dependencies?: Record<string, string>; engines?: { node?: string } }>(path.join(appDir, "package.json")) ?? {};
      const ranges: string[] = [];
      if (builtin) {
        // The framework major the app is on now, which the AI may have changed since scaffolding.
        const spec = pkg.dependencies?.[FRAMEWORK_PACKAGE[info.framework]];
        const major = spec && semver.validRange(spec) ? semver.minVersion(spec)?.major : undefined;
        ranges.push(builtin.node(major ?? info.versions?.[0] ?? 0));
      }
      if (pkg.engines?.node) ranges.push(pkg.engines.node);
      for (const file of [".nvmrc", ".node-version"]) {
        const v = readText(path.join(appDir, file))?.trim().replace(/^v/, "");
        if (v && semver.validRange(v)) ranges.push(v);
      }
      return ranges.filter((r) => r !== "*" && semver.validRange(r));
    },
  };
}

/**
 * Splits a dev command such as `PORT={port} npx vite --port {port}` into the
 * program, its arguments and leading environment assignments. No shell is
 * involved, so quoting is only for spaces inside an argument.
 */
export function parseCommand(raw: string, port: number, baseEnv: Record<string, string> = {}): DevCommand {
  const tokens = [...raw.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => (m[1] ?? m[2] ?? m[3]).replaceAll("{port}", String(port)));
  const env = { ...baseEnv };
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
    const t = tokens.shift()!;
    const i = t.indexOf("=");
    env[t.slice(0, i)] = t.slice(i + 1);
  }
  const program = tokens.shift();
  if (!program) throw new Error("The template's dev command is empty.");
  return { command: program, args: tokens, env };
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function readJson<T>(file: string): T | undefined {
  const text = readText(file);
  try {
    return text === undefined ? undefined : (JSON.parse(text) as T);
  } catch {
    return undefined;
  }
}

export function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
