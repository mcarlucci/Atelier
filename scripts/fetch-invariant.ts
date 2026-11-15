/**
 * Bundles the Invariant UI CLI (https://invariantui.com, npm package @invariant-ui/cli) into resources/invariant,
 * where packaging picks it up (see "extraResources" in package.json) and development runs find it. The build is
 * plain JavaScript, so one copy serves every platform. The version is pinned, so rebuilding a release bundles the
 * same CLI. Keep it in step with INVARIANT_RANGE in src/main/invariant/runner.ts.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const VERSION = "0.3.0";
const PACKAGE = "@invariant-ui/cli";
const target = path.join(import.meta.dirname, "..", "resources", "invariant");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

const work = fs.mkdtempSync(path.join(target, ".install-"));
try {
  fs.writeFileSync(path.join(work, "package.json"), JSON.stringify({ name: "atelier-invariant", private: true }));
  execFileSync(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", `${PACKAGE}@${VERSION}`], { cwd: work, stdio: "inherit", shell: process.platform === "win32" });
  const modules = path.join(work, "node_modules");
  fs.cpSync(path.join(modules, ...PACKAGE.split("/")), target, { recursive: true, dereference: true });
  // Hoisted dependencies sit beside the package; move them under it so it runs on its own.
  const deps = path.join(target, "node_modules");
  fs.mkdirSync(deps, { recursive: true });
  for (const name of fs.readdirSync(modules)) {
    if (name === "@invariant-ui" || name.startsWith(".")) continue;
    fs.cpSync(path.join(modules, name), path.join(deps, name), { recursive: true, dereference: true });
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

const pkg = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8")) as { version: string };
console.log(`Bundled ${PACKAGE} ${pkg.version} in ${path.relative(process.cwd(), target)}`);
