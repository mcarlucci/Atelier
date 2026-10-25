/**
 * Downloads the Node.js build Atelier ships with into resources/node, where
 * packaging picks it up (see "extraResources" in package.json) and development
 * runs find it. Defaults to the newest LTS for this machine:
 *
 *   node scripts/fetch-node.ts [--platform darwin|linux|win32] [--arch x64|arm64] [--range 24]
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_NODE_MIRROR, downloadRuntime, fetchReleases, parseRuntimeFolder, pickRelease } from "../src/main/node/dist.ts";

const { values } = parseArgs({
  options: {
    platform: { type: "string", default: process.platform },
    arch: { type: "string", default: process.arch },
    range: { type: "string", default: "*" },
  },
});
const target = { platform: values.platform as NodeJS.Platform, arch: values.arch! };
const mirror = process.env.ATELIER_NODE_MIRROR || DEFAULT_NODE_MIRROR;
const destDir = path.join(import.meta.dirname, "..", "resources", "node");

const version = pickRelease(await fetchReleases(fetch, mirror), [values.range!], target);
if (!version) throw new Error(`No Node.js release for ${target.platform}-${target.arch} satisfies ${values.range}.`);

// One bundled build per platform: drop older ones.
if (fs.existsSync(destDir)) {
  for (const name of fs.readdirSync(destDir)) {
    const v = parseRuntimeFolder(name, target);
    if (v && v !== version) fs.rmSync(path.join(destDir, name), { recursive: true, force: true });
  }
}
const dir = await downloadRuntime({ version, destDir, fetchFn: fetch, mirror, platform: target, onProgress: (t) => process.stdout.write(t) });
console.log(`Bundled Node.js ${version} in ${path.relative(process.cwd(), dir)}`);
