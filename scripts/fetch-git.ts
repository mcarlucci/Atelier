/**
 * Downloads the git build Atelier ships with into resources/git/<platform>-<arch>,
 * where packaging picks it up (see "extraResources" in package.json) and
 * development runs find it. Builds come from dugite-native, the portable git
 * that GitHub Desktop ships. Defaults to this machine:
 *
 *   node scripts/fetch-git.ts [--platform darwin|linux|win32] [--arch x64|arm64]
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { systemTar } from "../src/main/node/dist.ts";

// Pinned so every build ships the same, checksum-verified git.
const RELEASE = "v2.56.0-1";
const BUILD = "v2.56.0-7ce66f8";
const BASE = `https://github.com/desktop/dugite-native/releases/download/${RELEASE}`;
// git is GPL-2.0: its license ships next to the binaries (see THIRD_PARTY_NOTICES.md).
const GIT_VERSION = "v2.56.0";
const COPYING = `https://raw.githubusercontent.com/git/git/${GIT_VERSION}/COPYING`;

const PLATFORMS: Record<string, string> = { darwin: "macOS", linux: "ubuntu", win32: "windows" };

const { values } = parseArgs({
  options: {
    platform: { type: "string", default: process.platform },
    arch: { type: "string", default: process.arch },
  },
});
const platform = values.platform!;
const arch = values.arch!;
if (!PLATFORMS[platform] || !["x64", "arm64"].includes(arch)) throw new Error(`No bundled git for ${platform}-${arch}.`);

const asset = `dugite-native-${BUILD}-${PLATFORMS[platform]}-${arch}.tar.gz`;
const destDir = path.join(import.meta.dirname, "..", "resources", "git");
const target = path.join(destDir, `${platform}-${arch}`);
const stamp = path.join(target, ".atelier-git-version");

if (fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8").trim() === BUILD) {
  console.log(`git ${BUILD} for ${platform}-${arch} is already in ${path.relative(process.cwd(), target)}`);
  process.exit(0);
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Downloading ${url} failed: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

console.log(`Downloading ${asset}`);
const [archive, checksum, license] = await Promise.all([
  download(`${BASE}/${asset}`),
  download(`${BASE}/${asset}.sha256`),
  download(COPYING),
]);
const expected = checksum.toString("utf8").trim().split(/\s+/)[0];
const actual = crypto.createHash("sha256").update(archive).digest("hex");
if (actual !== expected) throw new Error(`${asset} failed its checksum (expected ${expected}, got ${actual}).`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-git-"));
try {
  const file = path.join(work, asset);
  fs.writeFileSync(file, archive);
  const out = path.join(work, "out");
  fs.mkdirSync(out);
  // bsdtar ships with macOS and Windows 10+.
  execFileSync(systemTar(), ["-xzf", file, "-C", out], { stdio: "inherit" });
  prune(out);
  fs.writeFileSync(path.join(out, "COPYING"), license);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  fs.renameSync(out, target);
  fs.writeFileSync(stamp, `${BUILD}\n`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(`Bundled git ${BUILD} in ${path.relative(process.cwd(), target)}`);

/**
 * Drops what Atelier never runs: Git LFS, and on macOS and Linux the .NET Git
 * Credential Manager (about 100 MB) with its runtime and translations. On
 * Windows git itself needs .dll files, so only Git LFS goes.
 */
function prune(root: string): void {
  const gitCore = path.join(root, "libexec", "git-core");
  if (platform === "win32") {
    for (const dir of ["ucrt64", "clangarm64"]) {
      fs.rmSync(path.join(root, dir, "libexec", "git-core", "git-lfs.exe"), { force: true });
    }
    return;
  }
  for (const name of fs.readdirSync(gitCore)) {
    const full = path.join(gitCore, name);
    const isDir = fs.statSync(full).isDirectory();
    const gcm =
      name.startsWith("git-credential-manager") ||
      /\.(dll|dylib|so|json|pdb)$/.test(name) ||
      ["createdump", "uninstall.sh", "NOTICE"].includes(name) ||
      // Credential Manager translations (de, zh-Hans, …). git's own mergetools folder stays.
      (isDir && name !== "mergetools");
    if (gcm || name === "git-lfs") fs.rmSync(full, { recursive: true, force: true });
  }
}
