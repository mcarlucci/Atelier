/**
 * Runs Invariant UI (https://invariantui.com) for Atelier. The CLI is installed
 * once into an Atelier-managed folder and run with Atelier's own Node.js, so
 * users need neither. Each app gets its own contract, compiled in its folder,
 * because Invariant's config only accepts paths inside one project root.
 */
import fs from "node:fs";
import path from "node:path";
import type { InvariantBrowserReport, InvariantValidateResult } from "@shared/invariant";
import { run, type RunResult } from "../process";
import { defaultBrowserSpec } from "./browser-spec";
import { runtimeCommand, runtimeEnv, type NodeRuntime } from "../node/runtimes";

export const INVARIANT_PACKAGE = "invariant-ui";
export const INVARIANT_RANGE = "^0.1.0";
export const PLAYWRIGHT_RANGE = "^1.64.0";
export const CONFIG_FILE = "invariant.config.json";
/**
 * Where the compiled contract goes, relative to the app. Inside node_modules because the app's Vite dev
 * server watches its folder and ignores node_modules: anywhere else, writing invariant.report.html reloads the preview.
 */
export const OUTPUT_DIR = "node_modules/.invariant";

export type Exec = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<RunResult>;

export interface InvariantRunnerOptions {
  /** Writable folder the CLI is installed into. */
  toolDir: string;
  node(): Promise<NodeRuntime>;
  /** Read-only folder holding the invariant-ui package shipped with the app (resources/invariant). Preferred over an install. */
  bundledDir?: string;
  /** Replaced in tests. */
  exec?: Exec;
}

export interface DesignSystemSource {
  packageName: string;
  framework: "react" | "vue" | "angular";
}

export class InvariantRunner {
  private installing?: Promise<void>;
  private readonly exec: Exec;

  constructor(private readonly opts: InvariantRunnerOptions) {
    this.exec = opts.exec ?? ((command, args, o) => run(command, args, { ...o }));
  }

  private get pkgDir(): string {
    const { bundledDir } = this.opts;
    if (bundledDir && fs.existsSync(path.join(bundledDir, "package.json"))) return bundledDir;
    return path.join(this.opts.toolDir, "node_modules", INVARIANT_PACKAGE);
  }

  /** The installed CLI's version, or undefined when it is not installed. */
  version(): string | undefined {
    try {
      return (JSON.parse(fs.readFileSync(path.join(this.pkgDir, "package.json"), "utf8")) as { version: string }).version;
    } catch {
      return undefined;
    }
  }

  /** Installs the CLI if missing. Concurrent calls share one install. */
  ensureInstalled(): Promise<void> {
    if (this.version()) return Promise.resolve();
    this.installing ??= this.install().finally(() => {
      this.installing = undefined;
    });
    return this.installing;
  }

  private async install(): Promise<void> {
    const node = await this.opts.node();
    fs.mkdirSync(this.opts.toolDir, { recursive: true });
    const pj = path.join(this.opts.toolDir, "package.json");
    if (!fs.existsSync(pj)) fs.writeFileSync(pj, JSON.stringify({ name: "atelier-invariant", private: true }));
    const npm = runtimeCommand(node, "npm", [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `${INVARIANT_PACKAGE}@${INVARIANT_RANGE}`,
    ]);
    const res = await this.exec(npm.command, npm.args, { cwd: this.opts.toolDir, env: runtimeEnv(node, process.env) });
    if (res.code !== 0) throw new Error(`Installing ${INVARIANT_PACKAGE} failed:\n${tail(res)}`);
  }

  // ------------------------------------------------------------ Playwright (browser checks)

  private get playwrightMarker(): string {
    return path.join(this.opts.toolDir, ".playwright-ready");
  }

  /** Playwright and its Chromium are installed in Atelier's managed folder. */
  playwrightReady(): boolean {
    return fs.existsSync(this.playwrightMarker) && fs.existsSync(path.join(this.opts.toolDir, "node_modules", "playwright", "package.json"));
  }

  /**
   * Installs Playwright and Chromium once, for every app. Browsers live in Playwright's shared cache, so
   * apps stay free of the download. Concurrent calls share one install.
   */
  installPlaywright(onLog?: (line: string) => void): Promise<void> {
    this.playwrightInstall ??= this.doInstallPlaywright(onLog).finally(() => {
      this.playwrightInstall = undefined;
    });
    return this.playwrightInstall;
  }
  private playwrightInstall?: Promise<void>;

  private async doInstallPlaywright(onLog?: (line: string) => void): Promise<void> {
    if (this.playwrightReady()) return;
    const node = await this.opts.node();
    const env = runtimeEnv(node, process.env);
    fs.mkdirSync(this.opts.toolDir, { recursive: true });
    const pj = path.join(this.opts.toolDir, "package.json");
    if (!fs.existsSync(pj)) fs.writeFileSync(pj, JSON.stringify({ name: "atelier-invariant", private: true }));
    onLog?.("Installing Playwright");
    const npm = runtimeCommand(node, "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", `playwright@${PLAYWRIGHT_RANGE}`]);
    const installed = await this.exec(npm.command, npm.args, { cwd: this.opts.toolDir, env });
    if (installed.code !== 0) throw new Error(`Installing Playwright failed:\n${tail(installed)}`);
    onLog?.("Downloading the Chromium browser");
    const cli = runtimeCommand(node, "node", [path.join(this.opts.toolDir, "node_modules", "playwright", "cli.js"), "install", "chromium"]);
    const browser = await this.exec(cli.command, cli.args, { cwd: this.opts.toolDir, env });
    if (browser.code !== 0) throw new Error(`Installing the Chromium browser failed:\n${tail(browser)}`);
    fs.writeFileSync(this.playwrightMarker, "ok\n");
  }

  /** Makes the managed Playwright resolvable from the app, where Invariant looks for it. An app's own copy wins. */
  linkPlaywright(appDir: string): void {
    const link = path.join(appDir, "node_modules", "playwright");
    if (fs.existsSync(link)) return;
    fs.mkdirSync(path.dirname(link), { recursive: true });
    // A junction needs no admin rights on Windows.
    fs.symlinkSync(path.join(this.opts.toolDir, "node_modules", "playwright"), link, "junction");
  }

  private binPath(): string {
    const pkg = JSON.parse(fs.readFileSync(path.join(this.pkgDir, "package.json"), "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const bin = typeof pkg.bin === "string" ? pkg.bin : (pkg.bin?.invariant ?? Object.values(pkg.bin ?? {})[0]);
    if (!bin) throw new Error(`${INVARIANT_PACKAGE} has no bin entry.`);
    return path.join(this.pkgDir, bin);
  }

  /** Runs the CLI in `appDir`. Exit 1 means findings and is returned; exit 2 and above throw. */
  async cli(appDir: string, args: string[]): Promise<RunResult> {
    await this.ensureInstalled();
    const node = await this.opts.node();
    const cmd = runtimeCommand(node, "node", [this.binPath(), ...args, "--cwd", appDir]);
    const res = await this.exec(cmd.command, cmd.args, { cwd: appDir, env: runtimeEnv(node, process.env) });
    if (res.code !== 0 && res.code !== 1) throw new Error(`invariant ${args[0]} failed (exit ${res.code}):\n${tail(res)}`);
    return res;
  }

  /** Command line that serves the app's contract over MCP (stdio, read-only). */
  async mcpCommand(appDir: string): Promise<{ command: string; args: string[]; env: Record<string, string> }> {
    await this.ensureInstalled();
    const node = await this.opts.node();
    const cmd = runtimeCommand(node, "node", [this.binPath(), "mcp", "--cwd", appDir]);
    const env = Object.fromEntries(Object.entries(runtimeEnv(node, process.env)).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    return { ...cmd, env };
  }

  /** Writes invariant.config.json for an app: the design system package plus the app's own source. */
  writeConfig(appDir: string, ds: DesignSystemSource, appName: string): void {
    const config = {
      name: appName,
      // declarations: the design system is an installed package, read from its .d.ts files.
      sources: [{ id: "design-system", type: ds.framework, path: `node_modules/${ds.packageName}`, declarations: true }],
      output: { directory: OUTPUT_DIR },
      validation: { failOn: "never" },
    };
    fs.writeFileSync(path.join(appDir, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`);
  }

  /** Compiles the contract. Returns how many components it holds; 0 means the sources matched nothing. */
  async compile(appDir: string): Promise<{ components: number; tokens: number }> {
    const res = await this.cli(appDir, ["compile"]);
    if (res.code === 1) throw new Error(`Compile found problems:\n${tail(res)}`);
    const m = /components (\d+), tokens (\d+)/.exec(res.stdout);
    return { components: Number(m?.[1] ?? 0), tokens: Number(m?.[2] ?? 0) };
  }

  /** True when the compiled contract is current. */
  async verifyFresh(appDir: string): Promise<boolean> {
    return (await this.cli(appDir, ["verify", "--fresh"])).code === 0;
  }

  /** Validates files (project-relative) against the contract. Violations are a result, not an error. */
  async validate(appDir: string, files: string[]): Promise<InvariantValidateResult> {
    if (files.length === 0) throw new Error("No files to validate.");
    const res = await this.cli(appDir, ["validate", ...files, "--format", "json", "--fail-on", "never"]);
    return parseJson<InvariantValidateResult>(res.stdout, "validate");
  }

  async browserRun(appDir: string, url: string): Promise<InvariantBrowserReport> {
    if (!this.playwrightReady() && !fs.existsSync(path.join(appDir, "node_modules", "playwright"))) {
      throw new Error("Browser checks need Playwright. Install it from the Governance tab.");
    }
    if (this.playwrightReady()) this.linkPlaywright(appDir);
    const res = await this.cli(appDir, ["browser", "run", "--spec", this.browserSpecFor(appDir, url), "--url", url, "--json"]);
    return parseJson<InvariantBrowserReport>(res.stdout, "browser run");
  }

  /**
   * The spec to run: the app's own invariant.browser.json when it has one, otherwise Atelier's default, written
   * next to the contract (outside what the dev server watches and git tracks) with the preview's current URL.
   */
  browserSpecFor(appDir: string, url: string): string {
    const own = path.join(appDir, "invariant.browser.json");
    if (fs.existsSync(own)) return own;
    const file = path.join(appDir, OUTPUT_DIR, "invariant.browser.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(defaultBrowserSpec(url), null, 2)}\n`);
    return file;
  }
}

function parseJson<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`invariant ${what} returned output that is not JSON.`);
  }
}

function tail(res: RunResult): string {
  return (res.stderr || res.stdout).trim().split("\n").slice(-15).join("\n");
}
