/**
 * Official Node.js builds from nodejs.org/dist (or a mirror): which file a
 * platform needs, which version fits a range, and downloading one with its
 * SHA-256 checked against the release's SHASUMS256.txt.
 *
 * Only Node built-ins and semver are imported, so scripts/fetch-node.ts can
 * load this file directly with `node`.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import semver from "semver";

export const DEFAULT_NODE_MIRROR = "https://nodejs.org/dist";

export type FetchFn = (url: string) => Promise<Response>;

export interface NodePlatform {
  platform: NodeJS.Platform;
  arch: string;
}

export const CURRENT_PLATFORM: NodePlatform = { platform: process.platform, arch: process.arch };

export interface DistRelease {
  version: string;
  /** Platform keys such as `osx-arm64-tar`, `linux-x64`, `win-x64-zip`. */
  files: string[];
  /** LTS codename, or false. */
  lts: string | false;
}

interface PlatformLayout {
  /** Key in index.json `files`. */
  indexKey: string;
  /** Folder name inside the archive, which is also the archive name without extension. */
  folder(version: string): string;
  ext: ".tar.gz" | ".zip";
}

function layout({ platform, arch }: NodePlatform): PlatformLayout {
  if (arch !== "x64" && arch !== "arm64") throw new Error(`Atelier can't provide Node.js for ${platform} on ${arch}.`);
  switch (platform) {
    case "darwin":
      return { indexKey: `osx-${arch}-tar`, folder: (v) => `node-v${v}-darwin-${arch}`, ext: ".tar.gz" };
    case "linux":
      return { indexKey: `linux-${arch}`, folder: (v) => `node-v${v}-linux-${arch}`, ext: ".tar.gz" };
    case "win32":
      return { indexKey: `win-${arch}-zip`, folder: (v) => `node-v${v}-win-${arch}`, ext: ".zip" };
    default:
      throw new Error(`Atelier can't provide Node.js for ${platform}.`);
  }
}

/** Folder an extracted build lives in, such as `node-v24.15.0-darwin-arm64`. */
export function runtimeFolder(version: string, p: NodePlatform = CURRENT_PLATFORM): string {
  return layout(p).folder(version);
}

/** The version in a runtime folder name for this platform, or null for anything else. */
export function parseRuntimeFolder(name: string, p: NodePlatform = CURRENT_PLATFORM): string | null {
  const match = /^node-v(\d+\.\d+\.\d+)-/.exec(name);
  return match && name === runtimeFolder(match[1], p) ? match[1] : null;
}

/** Executables inside an extracted build. */
export function runtimePaths(root: string, p: NodePlatform = CURRENT_PLATFORM) {
  const win = p.platform === "win32";
  const binDir = win ? root : path.join(root, "bin");
  const npmDir = win ? path.join(root, "node_modules", "npm") : path.join(root, "lib", "node_modules", "npm");
  return {
    binDir,
    node: path.join(binDir, win ? "node.exe" : "node"),
    npmCli: path.join(npmDir, "bin", "npm-cli.js"),
    npxCli: path.join(npmDir, "bin", "npx-cli.js"),
  };
}

/**
 * Every range must hold. Prefers LTS lines (even majors) so an open range such
 * as `>=22` doesn't land on a short-lived odd release, then the newest version.
 */
export function pickRelease(releases: DistRelease[], ranges: string[], p: NodePlatform = CURRENT_PLATFORM): string | null {
  const key = layout(p).indexKey;
  const fits = releases
    .filter((r) => r.files.includes(key))
    .map((r) => ({ version: r.version.replace(/^v/, ""), lts: Boolean(r.lts) }))
    .filter((r) => semver.valid(r.version) && ranges.every((range) => semver.satisfies(r.version, range)));
  const best = (list: typeof fits) => semver.rsort(list.map((r) => r.version))[0] ?? null;
  return best(fits.filter((r) => r.lts)) ?? best(fits);
}

export async function fetchReleases(fetchFn: FetchFn, mirror = DEFAULT_NODE_MIRROR): Promise<DistRelease[]> {
  const res = await fetchFn(`${mirror}/index.json`);
  if (!res.ok) throw new Error(`Could not list Node.js releases from ${mirror} (HTTP ${res.status}).`);
  return (await res.json()) as DistRelease[];
}

/**
 * Downloads, verifies and extracts one build into `destDir/<runtimeFolder>`.
 * The folder only appears once extraction finished, so a half-done download
 * never looks installed.
 */
export async function downloadRuntime(opts: {
  version: string;
  destDir: string;
  fetchFn: FetchFn;
  mirror?: string;
  platform?: NodePlatform;
  onProgress?: (text: string) => void;
}): Promise<string> {
  const { version, destDir, fetchFn, mirror = DEFAULT_NODE_MIRROR, platform = CURRENT_PLATFORM, onProgress } = opts;
  const l = layout(platform);
  const folder = l.folder(version);
  const archive = `${folder}${l.ext}`;
  const base = `${mirror}/v${version}`;

  const sums = await fetchFn(`${base}/SHASUMS256.txt`);
  if (!sums.ok) throw new Error(`Could not read checksums for Node.js ${version} (HTTP ${sums.status}).`);
  const expected = new RegExp(`^([0-9a-f]{64})\\s+${archive.replaceAll(".", "\\.")}$`, "m").exec(await sums.text())?.[1];
  if (!expected) throw new Error(`Node.js ${version} has no ${archive} build.`);

  fs.mkdirSync(destDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(destDir, ".download-"));
  try {
    const res = await fetchFn(`${base}/${archive}`);
    if (!res.ok || !res.body) throw new Error(`Could not download Node.js ${version} (HTTP ${res.status}).`);
    const total = Number(res.headers.get("content-length")) || 0;
    const file = path.join(work, archive);
    const hash = crypto.createHash("sha256");
    const out = fs.createWriteStream(file);
    let received = 0;
    let reported = 0;
    for await (const chunk of Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>)) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
      const pct = total ? Math.floor((received / total) * 10) * 10 : 0;
      if (pct > reported) {
        reported = pct;
        onProgress?.(`Downloading Node.js ${version}: ${pct}%\n`);
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    if (hash.digest("hex") !== expected) throw new Error(`The Node.js ${version} download failed its checksum. Try again.`);

    onProgress?.(`Extracting Node.js ${version}\n`);
    // bsdtar ships with macOS and Windows 10+, and reads zip as well as tar.gz.
    await extract(file, work, l.ext === ".zip" ? ["-xf"] : ["-xzf"]);
    const target = path.join(destDir, folder);
    if (!fs.existsSync(target)) fs.renameSync(path.join(work, folder), target);
    return target;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function extract(file: string, cwd: string, flags: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", [...flags, file], { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Extracting Node.js failed: ${stderr.trim() || `tar exited with ${code}`}`))));
  });
}
