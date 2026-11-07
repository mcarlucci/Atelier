/**
 * Every design system Atelier offers with one click must give Invariant UI a contract that is valid, complete and free
 * of findings: no contract with fewer components than Atelier's own import finds, no failing verify, no error, and no
 * more warnings than known today. Imports each library and compiles it with the bundled Invariant UI. Hits the npm
 * registry: run with ATELIER_INTEGRATION=1 (and `npm run fetch-invariant` first).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POPULAR } from "@shared/popular";
import { importDesignSystem } from "../src/main/design-system/importer";
import { InvariantRunner } from "../src/main/invariant/runner";
import type { NodeRuntime } from "../src/main/node/runtimes";

const bundledDir = process.env.ATELIER_INVARIANT_DIR ?? path.join(__dirname, "..", "resources", "invariant");
const ready = !!process.env.ATELIER_INTEGRATION && fs.existsSync(path.join(bundledDir, "package.json"));
const node: NodeRuntime = {
  version: process.versions.node,
  source: "system",
  commands: { node: { command: process.execPath, args: [] }, npm: { command: "npm", args: [] }, npx: { command: "npx", args: [] } },
};

/**
 * What each library is allowed today. `gap` is components Atelier lists that the contract lacks (a context or provider
 * Atelier counts as a component); `warnings` is the most diagnostics of that severity. Lower them when Invariant
 * improves; never raise them without a reason written here.
 */
const KNOWN: Record<string, { gap: number; warnings: number }> = {
  "@radix-ui/themes": { gap: 0, warnings: 4 }, // props that extend a primitive Radix does not ship types for
  "@mui/material": { gap: 1, warnings: 1 },
  "@mantine/core": { gap: 0, warnings: 0 },
  vuetify: { gap: 0, warnings: 0 },
  primevue: { gap: 0, warnings: 0 },
  "element-plus": { gap: 0, warnings: 0 },
  primeng: { gap: 0, warnings: 0 },
  "@angular/material": { gap: 0, warnings: 2 }, // two package entries that do not resolve to a file
};

describe.skipIf(!ready)("Invariant contracts for the one-click design systems (network)", () => {
  it("covers every one-click library", () => {
    expect(POPULAR.map((p) => p.spec).sort()).toEqual(Object.keys(KNOWN).sort());
  });

  it.concurrent.each(POPULAR)("$spec", async ({ spec, framework }) => {
    const known = KNOWN[spec];
    const workDir = path.join(os.tmpdir(), `atelier-parity-${spec.replace(/[@/]/g, "_")}`);
    const ds = await importDesignSystem({ id: spec, source: { kind: "npm", spec }, workDir });
    const runner = new InvariantRunner({ toolDir: fs.mkdtempSync(path.join(os.tmpdir(), "atelier-parity-tool-")), bundledDir, node: async () => node });
    runner.writeConfig(workDir, { packageName: ds.packageName, framework }, ds.name);
    const { components } = await runner.compile(workDir);
    expect(components).toBeGreaterThanOrEqual(ds.components.length - known.gap);
    // The contract file parses, which is what every lookup the AI makes needs.
    expect(await runner.verifyFresh(workDir)).toBe(true);
    const { diagnostics } = JSON.parse(fs.readFileSync(path.join(workDir, "node_modules", ".invariant", "invariant.diagnostics.json"), "utf8")) as {
      diagnostics: { severity: string; code: string; message: string }[];
    };
    const of = (severity: string) => diagnostics.filter((d) => d.severity === severity);
    expect(of("error").map((d) => d.message)).toEqual([]);
    expect(of("warning").length, of("warning").map((d) => `${d.code}: ${d.message}`).slice(0, 5).join("\n")).toBeLessThanOrEqual(known.warnings);
  }, 300_000);
});
