/**
 * Bundles Invariant UI (https://invariantui.com) into resources/invariant,
 * where packaging picks it up (see "extraResources" in package.json) and
 * development runs find it. The build is plain JavaScript, so one copy serves
 * every platform. Until invariant-ui is on npm, point this at a built package:
 *
 *   node scripts/fetch-invariant.ts --from <path to invariant/dist-npm>
 *
 * (build one with `pnpm run build:npm` in the Invariant repo). With no --from,
 * it installs invariant-ui from npm at the version in src/main/invariant/runner.ts.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { from: { type: "string" } } });
const target = path.join(import.meta.dirname, "..", "resources", "invariant");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

if (values.from) {
  const from = path.resolve(values.from);
  if (!fs.existsSync(path.join(from, "package.json"))) throw new Error(`${from} is not a built invariant-ui package.`);
  // Copy without node_modules; dependencies are installed fresh below.
  fs.cpSync(from, target, { recursive: true, filter: (src) => path.basename(src) !== "node_modules" });
  execFileSync(npm, ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: target, stdio: "inherit", shell: process.platform === "win32" });
} else {
  const work = fs.mkdtempSync(path.join(target, ".install-"));
  try {
    fs.writeFileSync(path.join(work, "package.json"), JSON.stringify({ name: "atelier-invariant", private: true }));
    execFileSync(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", "invariant-ui@^0.1.0"], { cwd: work, stdio: "inherit", shell: process.platform === "win32" });
    fs.cpSync(path.join(work, "node_modules", "invariant-ui"), target, { recursive: true, dereference: true });
    // Hoisted dependencies sit beside the package; move them under it so it runs on its own.
    const deps = path.join(target, "node_modules");
    fs.mkdirSync(deps, { recursive: true });
    for (const name of fs.readdirSync(path.join(work, "node_modules"))) {
      if (name === "invariant-ui" || name.startsWith(".")) continue;
      fs.cpSync(path.join(work, "node_modules", name), path.join(deps, name), { recursive: true, dereference: true });
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8")) as { version: string };
console.log(`Bundled invariant-ui ${pkg.version} in ${path.relative(process.cwd(), target)}`);
