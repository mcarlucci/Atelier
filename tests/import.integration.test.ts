import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FrameworkId } from "@shared/types";
import { importDesignSystem } from "../src/main/design-system/importer";
import { builtinTemplateInfos, runtimeFor } from "../src/main/templates";
import { NPM, NPX, run, systemNodeVersion } from "../src/main/process";

/** Popular libraries, each published differently: root barrels, subpath maps, wildcard subpaths, no framework peer. */
const LIBRARIES: { spec: string; framework: FrameworkId; min: number; has: string[]; css?: string; provider?: string; plugin?: string }[] = [
  { spec: "@radix-ui/themes", framework: "react", min: 20, has: ["Button", "Dialog.Root", "TextField.Root"], provider: "Theme" },
  { spec: "@mantine/core", framework: "react", min: 50, has: ["Button", "TextInput"], css: "@mantine/core/styles.css", provider: "MantineProvider" },
  { spec: "@mui/material", framework: "react", min: 50, has: ["Button", "TextField"] },
  // Components only behind `./components`, a plain .js subpath.
  { spec: "vuetify", framework: "vue", min: 100, has: ["VBtn", "VTextField", "VApp"], css: "vuetify/styles", provider: "VApp", plugin: "createVuetify" },
  // No `vue` in its peer dependencies.
  { spec: "primevue", framework: "vue", min: 50, has: ["Button", "InputText"], plugin: "default as PrimeVue" },
  { spec: "element-plus", framework: "vue", min: 50, has: ["ElButton", "ElInput"] },
  { spec: "primeng", framework: "angular", min: 30, has: ["Button"] },
  { spec: "@angular/material", framework: "angular", min: 20, has: ["MatButton"] },
];

// Hits the npm registry. Run with ATELIER_INTEGRATION=1.
describe.skipIf(!process.env.ATELIER_INTEGRATION)("importDesignSystem (network)", () => {
  it.concurrent.each(LIBRARIES)("imports $spec", async (lib) => {
    const ds = await importDesignSystem({
      id: lib.spec,
      source: { kind: "npm", spec: lib.spec },
      workDir: path.join(os.tmpdir(), `atelier-it-${lib.spec.replace(/[@/]/g, "_")}`),
    });
    const names = ds.components.map((c) => c.name);
    expect(ds.framework).toBe(lib.framework);
    expect(ds.components.length).toBeGreaterThanOrEqual(lib.min);
    for (const name of lib.has) expect(names).toContain(name);
    if (lib.css) expect(ds.setup.globalCss).toContain(lib.css);
    if (lib.provider) expect(ds.setup.provider?.importName).toBe(lib.provider);
    if (lib.plugin) expect(ds.setup.vuePlugin?.importName).toBe(lib.plugin);
  }, 300_000);

  // The preset setup has to produce an app that builds with styled components.
  it.concurrent.each([
    // DesignSystemRoot renders <VApp>, which Vuetify components need.
    { spec: "vuetify", page: '<VBtn color="primary">Save</VBtn>', use: "VBtn", cssMarker: ".v-btn" },
    { spec: "primevue", page: '<Button label="Save" />', use: "Button", cssMarker: "" },
  ])("builds a Vue app with $spec", async ({ spec, page, use, cssMarker }) => {
    const ds = await importDesignSystem({
      id: spec,
      source: { kind: "npm", spec },
      workDir: path.join(os.tmpdir(), `atelier-it-build-ds-${spec}`),
    });
    const component = ds.components.find((c) => c.name === use)!;
    const runtime = runtimeFor(builtinTemplateInfos().find((t) => t.framework === "vue")!);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `atelier-it-build-${spec}-`));
    runtime.scaffold(dir, ds, "Build Check", { nodeVersion: await systemNodeVersion() });
    const importLine = runtime.kit.usage(component).split(";")[0];
    fs.writeFileSync(path.join(dir, "src/pages/IndexPage.vue"), `<script setup lang="ts">\n${importLine};\n</script>\n<template>${page}</template>\n`);

    const install = await run(NPM, ["install", "--no-audit", "--no-fund"], { cwd: dir });
    expect(install.code, install.stderr.slice(-2000)).toBe(0);
    const build = await run(NPX, ["vite", "build"], { cwd: dir });
    expect(build.code, (build.stdout + build.stderr).slice(-3000)).toBe(0);
    if (cssMarker) {
      const assets = path.join(dir, "dist/assets");
      const css = fs.readdirSync(assets).filter((f) => f.endsWith(".css")).map((f) => fs.readFileSync(path.join(assets, f), "utf8")).join("");
      expect(css).toContain(cssMarker);
    }
  }, 600_000);
});
