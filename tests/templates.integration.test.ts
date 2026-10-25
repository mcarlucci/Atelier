import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DesignSystem, FrameworkId } from "@shared/types";
import { builtinTemplateInfos, runtimeFor } from "../src/main/templates";
import { NPM, NPX, run, systemNodeVersion } from "../src/main/process";

// Installs from the npm registry and builds each generated app. Run with ATELIER_INTEGRATION=1.
const DS_DIR = path.join(__dirname, "fixtures/ds-pkg");
const BUILD: Record<FrameworkId, string[]> = { react: ["vite", "build"], vue: ["vite", "build"], angular: ["ng", "build"] };

function ds(framework: FrameworkId): DesignSystem {
  return {
    id: "ds",
    name: "Acme UI",
    framework,
    packageName: "@acme/ui",
    version: "1.0.0",
    source: { kind: "local", path: DS_DIR },
    dependencySpec: `file:${DS_DIR}`,
    setup: { globalCss: ["@acme/ui/styles.css"], extraDependencies: {} },
    components: [],
    guidelines: "",
    tokens: [],
    importedAt: 0,
    warnings: [],
    hasAuthToken: false,
  };
}

function cssFiles(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".css")).map((f) => path.join(dir, f));
}

describe.skipIf(!process.env.ATELIER_INTEGRATION)("built-in templates build (network)", () => {
  for (const info of builtinTemplateInfos()) {
    it(`${info.name}: installs, builds with the design system styles, and serves`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `atelier-it-${info.id}-`));
      const runtime = runtimeFor(info);
      const warnings = runtime.scaffold(dir, ds(info.framework), "Integration App", { nodeVersion: await systemNodeVersion() });
      expect(warnings).toEqual([]);
      const env = { ...process.env, ...runtime.kit.env };

      const install = await run(NPM, ["install", "--no-audit", "--no-fund"], { cwd: dir, env });
      expect(install.code, install.stderr.slice(-2000)).toBe(0);
      const build = await run(NPX, BUILD[info.framework], { cwd: dir, env });
      expect(build.code, (build.stdout + build.stderr).slice(-3000)).toBe(0);
      const css = cssFiles(path.join(dir, "dist")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
      expect(css).toContain("--acme-marker");

      // The dev command the preview uses must serve the app.
      const port = 32900 + builtinTemplateInfos().indexOf(info);
      const cmd = runtime.devCommand(port);
      const child = spawn(cmd.command, cmd.args, { cwd: dir, env: { ...env, ...cmd.env }, detached: true });
      try {
        let ok = false;
        for (let i = 0; i < 240 && !ok; i++) {
          await new Promise((r) => setTimeout(r, 500));
          ok = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok, () => false);
        }
        expect(ok).toBe(true);
      } finally {
        process.kill(-child.pid!, "SIGTERM");
      }
    }, 600_000);
  }
});
