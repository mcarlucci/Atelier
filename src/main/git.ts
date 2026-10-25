import { run, runOrThrow } from "./process";
import type { VersionInfo } from "@shared/types";

const AUTHOR = ["-c", "user.name=Atelier", "-c", "user.email=atelier@localhost"];

export async function gitInit(dir: string): Promise<void> {
  await runOrThrow("git", ["init", "-q", "-b", "main"], { cwd: dir });
}

/** Stages everything and commits. Returns the new hash, or null when nothing changed. */
export async function gitCommitAll(dir: string, message: string): Promise<string | null> {
  await runOrThrow("git", ["add", "-A"], { cwd: dir });
  const status = await runOrThrow("git", ["status", "--porcelain"], { cwd: dir });
  if (!status.trim()) return null;
  await runOrThrow("git", [...AUTHOR, "commit", "-q", "-m", message], { cwd: dir });
  return (await runOrThrow("git", ["rev-parse", "HEAD"], { cwd: dir })).trim();
}

export async function gitLog(dir: string, limit = 100): Promise<VersionInfo[]> {
  const result = await run("git", ["log", `-n${limit}`, "--format=%H%x1f%ct%x1f%s"], { cwd: dir });
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
  await runOrThrow("git", ["rm", "-r", "-q", "--cached", "."], { cwd: dir });
  await runOrThrow("git", ["checkout", hash, "--", "."], { cwd: dir });
  await runOrThrow("git", ["clean", "-fdq", "-e", "node_modules"], { cwd: dir });
  return gitCommitAll(dir, `Restore version ${hash.slice(0, 7)}`);
}

export async function gitTrackedFiles(dir: string): Promise<string[]> {
  const out = await runOrThrow("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: dir,
  });
  return out.split("\n").filter(Boolean).sort();
}
