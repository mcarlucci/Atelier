import fs from "node:fs";
import path from "node:path";
import { run, runOrThrow } from "./process";
import type { VersionInfo } from "@shared/types";

interface BundledGit {
  binary: string;
  /** Prepended to PATH, so npm and dev servers find the same git. */
  pathDirs: string[];
  env: Record<string, string>;
}

let bundled: BundledGit | undefined;

/**
 * Uses the git build packaged with Atelier (scripts/fetch-git.ts) from
 * `root/<platform>-<arch>`, so users don't need git installed. Without one
 * (a development checkout that skipped fetch-git), git on PATH is used.
 * The environment matches what dugite, GitHub Desktop's git wrapper, sets up.
 */
export function useBundledGit(root: string): void {
  const dir = path.join(root, `${process.platform}-${process.arch}`);
  const win = process.platform === "win32";
  const binary = win ? path.join(dir, "cmd", "git.exe") : path.join(dir, "bin", "git");
  if (!fs.existsSync(binary)) return;
  if (win) {
    const sub = process.arch === "arm64" ? "clangarm64" : "ucrt64";
    bundled = {
      binary,
      pathDirs: [path.dirname(binary), path.join(dir, sub, "bin"), path.join(dir, sub, "usr", "bin")],
      env: { GIT_EXEC_PATH: path.join(dir, sub, "libexec", "git-core") },
    };
    return;
  }
  const env: Record<string, string> = {
    GIT_EXEC_PATH: path.join(dir, "libexec", "git-core"),
    // Git's own defaults, which still include the real /etc/gitconfig.
    GIT_CONFIG_SYSTEM: path.join(dir, "etc", "gitconfig"),
    GIT_TEMPLATE_DIR: path.join(dir, "share", "git-core", "templates"),
  };
  if (process.platform === "linux") {
    env.PREFIX = dir;
    env.GIT_SSL_CAINFO = path.join(dir, "ssl", "cacert.pem");
  }
  bundled = { binary, pathDirs: [path.dirname(binary)], env };
}

/** `env` with the bundled git first on PATH and its settings added. Unchanged when git comes from PATH. */
export function gitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!bundled) return env;
  // Windows environment keys are case-insensitive; keep whichever spelling is present.
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const extra = Object.fromEntries(Object.entries(bundled.env).filter(([k]) => k !== "GIT_CONFIG_SYSTEM" || !env[k]));
  return { ...env, ...extra, [key]: [...bundled.pathDirs, env[key]].filter(Boolean).join(path.delimiter) };
}

/** Runs git (bundled when available) and returns stdout, or throws with its output. */
export function runGit(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  return runOrThrow(bundled?.binary ?? "git", args, { ...options, env: gitEnv(options.env) });
}

const AUTHOR = ["-c", "user.name=Atelier", "-c", "user.email=atelier@localhost"];

export async function gitInit(dir: string): Promise<void> {
  await runGit(["init", "-q", "-b", "main"], { cwd: dir });
}

/** Stages everything and commits. Returns the new hash, or null when nothing changed. */
export async function gitCommitAll(dir: string, message: string): Promise<string | null> {
  await runGit(["add", "-A"], { cwd: dir });
  const status = await runGit(["status", "--porcelain"], { cwd: dir });
  if (!status.trim()) return null;
  await runGit([...AUTHOR, "commit", "-q", "-m", message], { cwd: dir });
  return (await runGit(["rev-parse", "HEAD"], { cwd: dir })).trim();
}

export async function gitLog(dir: string, limit = 100): Promise<VersionInfo[]> {
  const result = await run(bundled?.binary ?? "git", ["log", `-n${limit}`, "--format=%H%x1f%ct%x1f%s"], { cwd: dir, env: gitEnv() });
  if (result.code !== 0) return [];
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, ts, message] = line.split("\x1f");
      return { hash, timestamp: Number(ts) * 1000, message };
    });
}

/**
 * Restores the working tree to `hash` as a new commit, so history is never
 * rewritten and the restore itself can be undone.
 */
export async function gitRestore(dir: string, hash: string): Promise<string | null> {
  if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new Error("Invalid commit hash");
  await runGit(["rm", "-r", "-q", "--cached", "."], { cwd: dir });
  await runGit(["checkout", hash, "--", "."], { cwd: dir });
  await runGit(["clean", "-fdq", "-e", "node_modules"], { cwd: dir });
  return gitCommitAll(dir, `Restore version ${hash.slice(0, 7)}`);
}

export async function gitTrackedFiles(dir: string): Promise<string[]> {
  const out = await runGit(["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: dir,
  });
  return out.split("\n").filter(Boolean).sort();
}
