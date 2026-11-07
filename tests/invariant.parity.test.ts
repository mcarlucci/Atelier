/**
 * An Invariant contract should never hold fewer components than Atelier's own import finds, or code using the missing
 * ones is never checked. Imports each popular library and compiles it with the bundled Invariant UI. Hits the npm
 * registry: run with ATELIER_INTEGRATION=1 (and `npm run fetch-invariant` first).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FrameworkId } from "@shared/types";
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
 * `gap` is how many components Atelier lists that the contract lacks today. They are contexts, providers and types that
 * Atelier counts as components. Lower it when Invariant closes the gap; never raise it.
 */
const LIBRARIES: { spec: string; framework: FrameworkId; gap: number }[] = [
  { spec: "@radix-ui/themes", framework: "react", gap: 0 },
  { spec: "@mantine/core", framework: "react", gap: 8 },
  { spec: "@mui/material", framework: "react", gap: 5 },
  { spec: "vuetify", framework: "vue", gap: 0 },
  { spec: "primevue", framework: "vue", gap: 0 },
  { spec: "element-plus", framework: "vue", gap: 0 },
  { spec: "primeng", framework: "angular", gap: 0 },
  { spec: "@angular/material", framework: "angular", gap: 0 },
];

describe.skipIf(!ready)("Invariant contract parity with Atelier's import (network)", () => {
  it.concurrent.each(LIBRARIES)("$spec", async ({ spec, framework, gap }) => {
    const workDir = path.join(os.tmpdir(), `atelier-parity-${spec.replace(/[@/]/g, "_")}`);
    const ds = await importDesignSystem({ id: spec, source: { kind: "npm", spec }, workDir });
    const runner = new InvariantRunner({ toolDir: fs.mkdtempSync(path.join(os.tmpdir(), "atelier-parity-tool-")), bundledDir, node: async () => node });
    runner.writeConfig(workDir, { packageName: ds.packageName, framework }, ds.name);
    const { components } = await runner.compile(workDir);
    expect(components).toBeGreaterThanOrEqual(ds.components.length - gap);
  }, 300_000);
});
