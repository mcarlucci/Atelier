import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { RunnerOutput, RunnerStatus } from "@shared/types";
import { run } from "./process";
import { runtimeCommand, runtimeEnv, type NodeRuntime } from "./node/runtimes";

const BASE_PORT = 32100;
const READY_TIMEOUT_MS = 120_000;

interface RunningApp {
  child?: ChildProcess;
  status: RunnerStatus;
  port: number;
}

export interface RunnerHooks {
  onOutput(output: RunnerOutput): void;
  onStatus(appId: string, status: RunnerStatus): void;
}

export interface RunTarget {
  appId: string;
  dir: string;
  devCommand: (port: number) => { command: string; args: string[]; env?: Record<string, string> };
  env: NodeJS.ProcessEnv;
  /** The app's Node.js, downloaded first if needed. Progress goes to `log`. */
  node(log: (text: string) => void): Promise<NodeRuntime>;
}

/** Installs and runs each app's dev server on its own port, from 32100 up. */
export class AppRunner {
  private apps = new Map<string, RunningApp>();
  private usedPorts = new Set<number>();

  constructor(private readonly hooks: RunnerHooks) {}

  status(appId: string): RunnerStatus {
    return this.apps.get(appId)?.status ?? { state: "stopped" };
  }

  async start(target: RunTarget, opts: { reinstall?: boolean } = {}): Promise<RunnerStatus> {
    const existing = this.apps.get(target.appId);
    if (existing && (existing.status.state === "running" || existing.status.state === "installing" || existing.status.state === "starting")) {
      return existing.status;
    }
    const entry: RunningApp = existing ?? { status: { state: "stopped" }, port: 0 };
    this.apps.set(target.appId, entry);

    try {
      if (opts.reinstall) fs.rmSync(path.join(target.dir, "node_modules"), { recursive: true, force: true });
      this.setStatus(target.appId, { state: "starting" });
      const rt = await this.runtime(target);
      if (needsInstall(target.dir)) {
        this.setStatus(target.appId, { state: "installing" });
        await this.install(target, [], rt);
      }
      this.setStatus(target.appId, { state: "starting" });
      // Another Atelier window or an unrelated server may hold a port, so probe each start.
      this.usedPorts.delete(entry.port);
      entry.port = await this.allocatePort();
      const dev = target.devCommand(entry.port);
      const { command, args } = runtimeCommand(rt, dev.command, dev.args);
      const child = spawn(command, args, { cwd: target.dir, env: runtimeEnv(rt, { ...target.env, ...dev.env }), detached: process.platform !== "win32" });
      // A missing program (a custom template's dev command) emits "error", not "exit".
      child.on("error", (err) => {
        if (entry.child !== child) return;
        entry.child = undefined;
        this.setStatus(target.appId, { state: "error", message: `Could not start the dev server: ${err.message}` });
      });
      entry.child = child;
      const emit = (stream: "stdout" | "stderr") => (d: Buffer) =>
        this.hooks.onOutput({ appId: target.appId, stream, text: d.toString() });
      child.stdout?.on("data", emit("stdout"));
      child.stderr?.on("data", emit("stderr"));
      child.on("exit", (code) => {
        if (entry.child !== child) return;
        entry.child = undefined;
        this.setStatus(
          target.appId,
          code === 0 || code === null ? { state: "stopped" } : { state: "error", message: `Dev server exited with code ${code}` },
        );
      });
      const url = `http://127.0.0.1:${entry.port}/`;
      await waitForHttp(url, READY_TIMEOUT_MS, () => entry.child !== child);
      if (entry.child !== child) return this.status(target.appId);
      this.setStatus(target.appId, { state: "running", url });
    } catch (err) {
      this.setStatus(target.appId, { state: "error", message: err instanceof Error ? err.message : String(err) });
    }
    return this.status(target.appId);
  }

  private async runtime(target: RunTarget): Promise<NodeRuntime> {
    const rt = await target.node((text) => {
      // Only a download logs, and it's part of installing.
      if (this.status(target.appId).state === "starting") this.setStatus(target.appId, { state: "installing" });
      this.hooks.onOutput({ appId: target.appId, stream: "system", text });
    });
    this.hooks.onOutput({ appId: target.appId, stream: "system", text: `Node.js ${rt.version}${rt.source === "system" ? " (this computer's)" : ""}\n` });
    return rt;
  }

  /** Runs `npm install [packages]` in the app folder, streaming output to the console panel. */
  async install(target: RunTarget, packages: string[], rt?: NodeRuntime): Promise<void> {
    rt ??= await this.runtime(target);
    const system = (text: string) => this.hooks.onOutput({ appId: target.appId, stream: "system", text });
    system(`$ npm install ${packages.join(" ")}\n`);
    const npmInstall = (extra: string[]) => {
      const npm = runtimeCommand(rt, "npm", ["install", "--no-audit", "--no-fund", ...extra, ...packages]);
      return run(npm.command, npm.args, {
        cwd: target.dir,
        env: runtimeEnv(rt, target.env),
        onOutput: (stream, text) => this.hooks.onOutput({ appId: target.appId, stream, text }),
      });
    };
    let result = await npmInstall([]);
    // Angular packages pin exact peer versions, so a template's lockfile and a newer
    // package often disagree by a patch release. npm's pre-v7 resolution accepts that.
    if (result.code !== 0 && /ERESOLVE/.test(result.stdout + result.stderr)) {
      system("Peer dependency conflict; retrying with --legacy-peer-deps\n");
      result = await npmInstall(["--legacy-peer-deps"]);
    }
    if (result.code !== 0) throw new Error(`npm install failed (exit ${result.code}). See the console for details.`);
  }

  stop(appId: string): void {
    const entry = this.apps.get(appId);
    if (!entry?.child) return;
    const child = entry.child;
    entry.child = undefined;
    killTree(child);
    this.setStatus(appId, { state: "stopped" });
  }

  async restart(target: RunTarget, opts: { reinstall?: boolean } = {}): Promise<RunnerStatus> {
    this.stop(target.appId);
    return this.start(target, opts);
  }

  stopAll(): void {
    for (const id of this.apps.keys()) this.stop(id);
  }

  private setStatus(appId: string, status: RunnerStatus): void {
    const entry = this.apps.get(appId);
    if (entry) entry.status = status;
    this.hooks.onStatus(appId, status);
  }

  private async allocatePort(): Promise<number> {
    for (let port = BASE_PORT; port < BASE_PORT + 1000; port++) {
      if (this.usedPorts.has(port) || !(await isPortFree(port))) continue;
      this.usedPorts.add(port);
      return port;
    }
    throw new Error(`No free port between ${BASE_PORT} and ${BASE_PORT + 999}`);
  }
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

function needsInstall(dir: string): boolean {
  const marker = path.join(dir, "node_modules", ".package-lock.json");
  if (!fs.existsSync(marker)) return true;
  return fs.statSync(path.join(dir, "package.json")).mtimeMs > fs.statSync(marker).mtimeMs;
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    // npm spawns the dev server as a grandchild; kill the whole process group.
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function waitForHttp(url: string, timeoutMs: number, cancelled: () => boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cancelled()) return;
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Dev server did not respond at ${url} within ${timeoutMs / 1000}s`);
}
