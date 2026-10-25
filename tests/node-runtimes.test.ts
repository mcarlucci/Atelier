import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRuntimeFolder, pickRelease, runtimeFolder, type DistRelease, type NodePlatform } from "../src/main/node/dist";
import { NodeRuntimes, runtimeCommand, runtimeEnv } from "../src/main/node/runtimes";
import { builtinTemplateInfos, runtimeFor } from "../src/main/templates";

const mac: NodePlatform = { platform: "darwin", arch: "arm64" };
const win: NodePlatform = { platform: "win32", arch: "x64" };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "atelier-node-"));

const RELEASES: DistRelease[] = [
  { version: "v27.0.0", files: ["osx-arm64-tar", "linux-x64"], lts: false },
  { version: "v26.2.0", files: ["osx-arm64-tar", "linux-x64"], lts: "Krypton" },
  { version: "v24.16.0", files: ["osx-arm64-tar", "linux-x64"], lts: "Krypton" },
  { version: "v24.11.1", files: ["osx-arm64-tar", "linux-x64", "win-x64-zip"], lts: "Krypton" },
];

/** A folder that looks like an extracted macOS build. */
function fakeBuild(dir: string, version: string): string {
  const root = path.join(dir, runtimeFolder(version, mac));
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  fs.writeFileSync(path.join(root, "bin", "node"), "");
  return root;
}

const noFetch = async (): Promise<Response> => {
  throw new Error("offline");
};

describe("Node.js releases", () => {
  it("picks the newest LTS that satisfies every range and has a build for the platform", () => {
    expect(pickRelease(RELEASES, ["*"], mac)).toBe("26.2.0");
    expect(pickRelease(RELEASES, ["^22.22.3 || ^24.15.0 || >=26.0.0", "<26"], mac)).toBe("24.16.0");
    expect(pickRelease(RELEASES, [">=27"], mac)).toBe("27.0.0");
    expect(pickRelease(RELEASES, ["*"], win)).toBe("24.11.1");
    expect(pickRelease(RELEASES, [">=30"], mac)).toBeNull();
  });

  it("only reads runtime folders for the current platform", () => {
    expect(parseRuntimeFolder("node-v24.16.0-darwin-arm64", mac)).toBe("24.16.0");
    expect(parseRuntimeFolder("node-v24.16.0-darwin-x64", mac)).toBeNull();
    expect(parseRuntimeFolder("node-v24.16.0-win-x64", win)).toBe("24.16.0");
    expect(parseRuntimeFolder(".download-abc", mac)).toBeNull();
  });
});

describe("NodeRuntimes", () => {
  it("keeps an app's pinned version while it fits, else uses the newest fitting build", async () => {
    const bundled = tmp();
    const cache = tmp();
    fakeBuild(bundled, "24.16.0");
    fakeBuild(cache, "22.22.3");
    fakeBuild(cache, "26.2.0");
    const runtimes = new NodeRuntimes({ bundledDir: bundled, cacheDir: cache, fetchFn: noFetch, platform: mac });
    expect(runtimes.installed().map((r) => [r.version, r.source])).toEqual([
      ["26.2.0", "downloaded"],
      ["24.16.0", "bundled"],
      ["22.22.3", "downloaded"],
    ]);
    expect((await runtimes.resolve(["^22.22.3 || ^24.15.0"], { preferred: "22.22.3" })).version).toBe("22.22.3");
    expect((await runtimes.resolve(["^22.22.3 || ^24.15.0"])).version).toBe("24.16.0");
    expect((await runtimes.resolve([], { preferred: "20.0.0" })).version).toBe("26.2.0");
  });

  it("runs npm and npx through the runtime's node, with its bin first on PATH", async () => {
    const bundled = tmp();
    const root = fakeBuild(bundled, "24.16.0");
    const rt = await new NodeRuntimes({ bundledDir: bundled, cacheDir: tmp(), fetchFn: noFetch, platform: mac }).resolve([]);
    const node = path.join(root, "bin", "node");
    expect(runtimeCommand(rt, "npx", ["ng", "serve"])).toEqual({ command: node, args: [path.join(root, "lib/node_modules/npm/bin/npx-cli.js"), "ng", "serve"] });
    expect(runtimeCommand(rt, "docker", ["run"])).toEqual({ command: "docker", args: ["run"] });
    expect(runtimeEnv(rt, { PATH: "/usr/bin" }).PATH).toBe([path.join(root, "bin"), "/usr/bin"].join(path.delimiter));
  });

  it("downloads a missing version once, checking its checksum", async () => {
    const version = "26.2.0";
    const archiveName = `${runtimeFolder(version, mac)}.tar.gz`;
    const src = tmp();
    fakeBuild(src, version);
    execFileSync("tar", ["-czf", archiveName, runtimeFolder(version, mac)], { cwd: src });
    const archive = fs.readFileSync(path.join(src, archiveName));
    const sha = crypto.createHash("sha256").update(archive).digest("hex");
    const requests: string[] = [];
    const fetchFn = async (url: string) => {
      requests.push(url);
      if (url.endsWith("/index.json")) return Response.json(RELEASES);
      if (url.endsWith("/SHASUMS256.txt")) return new Response(`${"0".repeat(64)}  other.tar.gz\n${sha}  ${archiveName}\n`);
      if (url.endsWith(archiveName)) return new Response(archive, { headers: { "content-length": String(archive.length) } });
      return new Response("", { status: 404 });
    };
    const cache = tmp();
    const runtimes = new NodeRuntimes({ cacheDir: cache, fetchFn, platform: mac, mirror: "https://mirror.test/dist/" });
    const [a, b] = await Promise.all([runtimes.resolve([">=26"]), runtimes.resolve([">=26"])]);
    expect(a).toMatchObject({ version, source: "downloaded" });
    expect(b.version).toBe(version);
    expect(requests.filter((u) => u.endsWith(archiveName))).toEqual([`https://mirror.test/dist/v${version}/${archiveName}`]);
    expect(fs.readdirSync(cache)).toEqual([runtimeFolder(version, mac)]);
  });

  it("rejects a download whose checksum doesn't match", async () => {
    const archiveName = `${runtimeFolder("26.2.0", mac)}.tar.gz`;
    const fetchFn = async (url: string) =>
      url.endsWith("/index.json")
        ? Response.json(RELEASES)
        : url.endsWith("/SHASUMS256.txt")
          ? new Response(`${"0".repeat(64)}  ${archiveName}\n`)
          : new Response("tampered");
    const cache = tmp();
    const runtimes = new NodeRuntimes({ cacheDir: cache, fetchFn, platform: mac, systemVersion: async () => undefined });
    await expect(runtimes.resolve([">=26"])).rejects.toThrow(/checksum/);
    expect(fs.readdirSync(cache)).toEqual([]);
  });

  it("falls back to the Node.js on PATH when offline, and explains when nothing fits", async () => {
    const opts = { cacheDir: tmp(), fetchFn: noFetch, platform: mac };
    expect(await new NodeRuntimes({ ...opts, systemVersion: async () => "24.16.0" }).resolve(["^24.15.0"])).toMatchObject({ version: "24.16.0", source: "system" });
    await expect(new NodeRuntimes({ ...opts, systemVersion: async () => "24.11.1" }).resolve(["^24.15.0"])).rejects.toThrow(
      /needs Node\.js \^24\.15\.0, and Atelier couldn't download it: offline/,
    );
  });
});

describe("template Node.js ranges", () => {
  const angular = runtimeFor(builtinTemplateInfos().find((t) => t.id === "angular-cli")!);
  const app = (files: Record<string, string>) => {
    const dir = tmp();
    for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), content);
    return dir;
  };

  it("follows the Angular major the app is on, plus engines and .nvmrc", () => {
    expect(angular.nodeRanges(app({ "package.json": JSON.stringify({ dependencies: { "@angular/core": "^22.0.0" } }) }))).toEqual(["^22.22.3 || ^24.15.0 || >=26.0.0"]);
    expect(
      angular.nodeRanges(app({ "package.json": JSON.stringify({ dependencies: { "@angular/core": "^21.0.0" }, engines: { node: ">=22" } }), ".nvmrc": "v24\n" })),
    ).toEqual(["^20.19.0 || ^22.12.0 || >=24.0.0", ">=22", "24"]);
  });
});
