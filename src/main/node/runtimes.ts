/**
 * The Node.js that installs and runs each app. Users don't need Node.js
 * installed: Atelier ships one LTS build and downloads others when a
 * template's toolchain needs a version outside it.
 */
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { gitEnv } from "../git";
import { NPM, NPX, systemNodeVersion } from "../process";
import {
  CURRENT_PLATFORM,
  DEFAULT_NODE_MIRROR,
  downloadRuntime,
  fetchReleases,
  parseRuntimeFolder,
  pickRelease,
  runtimePaths,
  type DistRelease,
  type FetchFn,
  type NodePlatform,
} from "./dist";

export interface NodeRuntime {
  version: string;
  /** Shipped with Atelier, downloaded by it, or the user's own Node.js on PATH (last resort). */
  source: "bundled" | "downloaded" | "system";
  /** Put first on PATH so package scripts that call node or npm get this runtime. Absent for the system one. */
  binDir?: string;
  commands: Record<"node" | "npm" | "npx", { command: string; args: string[] }>;
}

export interface NodeRuntimesOptions {
  /** Read-only folder of builds shipped with the app. */
  bundledDir?: string;
  /** Writable folder for downloaded builds. */
  cacheDir: string;
  fetchFn: FetchFn;
  mirror?: string;
  platform?: NodePlatform;
  /** Finds the Node.js on PATH. Tests replace it. */
  systemVersion?: () => Promise<string | undefined>;
}

export class NodeRuntimes {
  private releases?: Promise<DistRelease[]>;
  private downloads = new Map<string, Promise<NodeRuntime>>();
  private readonly platform: NodePlatform;
  private readonly mirror: string;

  constructor(private readonly opts: NodeRuntimesOptions) {
    this.platform = opts.platform ?? CURRENT_PLATFORM;
    this.mirror = (opts.mirror || DEFAULT_NODE_MIRROR).replace(/\/+$/, "");
  }

  /** Builds already on disk, newest first. A bundled build wins over a downloaded copy of the same version. */
  installed(): NodeRuntime[] {
    const found = new Map<string, NodeRuntime>();
    const scan = (dir: string | undefined, source: "bundled" | "downloaded") => {
      if (!dir || !fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir)) {
        const version = parseRuntimeFolder(name, this.platform);
        if (!version || found.has(version)) continue;
        const rt = this.fromFolder(path.join(dir, name), version, source);
        if (fs.existsSync(rt.commands.node.command)) found.set(version, rt);
      }
    };
    scan(this.opts.bundledDir, "bundled");
    scan(this.opts.cacheDir, "downloaded");
    return [...found.values()].sort((a, b) => semver.rcompare(a.version, b.version));
  }

  /**
   * A runtime satisfying every range: `preferred` when it still fits (an app's
   * pinned version), else the newest installed one, else a download, else the
   * Node.js on PATH. Throws with a message for the user when nothing fits.
   */
  async resolve(ranges: string[], opts: { preferred?: string; onLog?: (text: string) => void } = {}): Promise<NodeRuntime> {
    const valid = ranges.filter((r) => semver.validRange(r));
    const fits = (v: string) => valid.every((r) => semver.satisfies(v, r));
    const installed = this.installed();

    if (opts.preferred && fits(opts.preferred)) {
      const pinned = installed.find((r) => r.version === opts.preferred);
      if (pinned) return pinned;
      try {
        return await this.download(opts.preferred, opts.onLog);
      } catch {
        // Fall through to any other fitting version.
      }
    }
    const local = installed.find((r) => fits(r.version));
    if (local) return local;

    let downloadError: unknown;
    try {
      const version = pickRelease(await this.listReleases(), valid, this.platform);
      if (version) return await this.download(version, opts.onLog);
      downloadError = new Error(`No Node.js release satisfies ${valid.join(" and ")}.`);
    } catch (err) {
      downloadError = err;
    }

    const system = await (this.opts.systemVersion ?? systemNodeVersion)();
    if (system && semver.valid(system) && fits(system)) {
      opts.onLog?.(`Using the Node.js ${system} on this computer: ${errorText(downloadError)}\n`);
      return {
        version: system,
        source: "system",
        commands: { node: { command: "node", args: [] }, npm: { command: NPM, args: [] }, npx: { command: NPX, args: [] } },
      };
    }
    throw new Error(`This app needs Node.js ${valid.join(" and ") || "(any)"}, and Atelier couldn't download it: ${errorText(downloadError)}`);
  }

  private listReleases(): Promise<DistRelease[]> {
    this.releases ??= fetchReleases(this.opts.fetchFn, this.mirror).catch((err) => {
      this.releases = undefined;
      throw err;
    });
    return this.releases;
  }

  /** One download per version, however many apps ask at once. */
  private download(version: string, onLog?: (text: string) => void): Promise<NodeRuntime> {
    let pending = this.downloads.get(version);
    if (!pending) {
      onLog?.(`Node.js ${version} isn't on this computer yet. Downloading it once for all apps.\n`);
      pending = downloadRuntime({ version, destDir: this.opts.cacheDir, fetchFn: this.opts.fetchFn, mirror: this.mirror, platform: this.platform, onProgress: onLog })
        .then((dir) => this.fromFolder(dir, version, "downloaded"))
        .finally(() => this.downloads.delete(version));
      this.downloads.set(version, pending);
    }
    return pending;
  }

  private fromFolder(root: string, version: string, source: "bundled" | "downloaded"): NodeRuntime {
    const p = runtimePaths(root, this.platform);
    return {
      version,
      source,
      binDir: p.binDir,
      commands: {
        node: { command: p.node, args: [] },
        // Through node directly: Windows can't spawn npm.cmd without a shell.
        npm: { command: p.node, args: [p.npmCli] },
        npx: { command: p.node, args: [p.npxCli] },
      },
    };
  }
}

/** The command line for `program args` under a runtime. Programs other than node, npm and npx run as given. */
export function runtimeCommand(rt: NodeRuntime, program: string, args: string[]): { command: string; args: string[] } {
  const known = rt.commands[program as keyof NodeRuntime["commands"]];
  return known ? { command: known.command, args: [...known.args, ...args] } : { command: program, args };
}

/** `env` with the runtime first on PATH. */
export function runtimeEnv(rt: NodeRuntime, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // npm runs git for git-hosted dependencies, so it gets the bundled git too.
  const env = gitEnv(baseEnv);
  if (!rt.binDir) return env;
  // Windows environment keys are case-insensitive; keep whichever spelling is present.
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  return { ...env, [key]: [rt.binDir, env[key]].filter(Boolean).join(path.delimiter) };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
