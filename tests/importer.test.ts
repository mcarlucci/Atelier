import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DesignSystem } from "@shared/types";
import { detectCss, findEntryPoints, noComponentsMessage } from "../src/main/design-system/importer";
import { extractComponents } from "../src/main/design-system/extract";
import { vuePreset } from "../src/main/design-system/presets";
import { vueKit, vueSetup } from "../src/main/frameworks/vue";

const VUE_COMPONENT = (prop: string) => `{ new (): { $props: { ${prop}?: string; $children?: unknown } } }`;

/** Writes a package folder from a map of relative paths to contents. */
function pkgDir(files: Record<string, string | object>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-pkg-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

describe("findEntryPoints", () => {
  // Vuetify's shape: the root types hold no components, and `./components` points at JavaScript.
  const vuetifyLike = {
    name: "vlib",
    version: "1.0.0",
    exports: {
      ".": { types: "./lib/framework.d.ts", default: "./lib/framework.js" },
      "./styles": { types: "./lib/styles.d.ts", default: "./lib/main.css" },
      "./components": "./lib/components/index.js",
      "./components/*": "./lib/components/*/index.js",
      "./dist/vlib.js": { types: "./dist/vlib.d.ts", default: "./dist/vlib.js" },
    },
  };
  const dir = pkgDir({
    "package.json": vuetifyLike,
    "lib/framework.d.ts": "export declare function createVlib(): object;",
    "lib/styles.d.ts": "",
    "lib/main.css": ":root { --v-x: 1; }",
    "lib/components/index.d.ts": `export * from "./VBtn/index.js";`,
    "lib/components/VBtn/index.d.ts": `export declare const VBtn: ${VUE_COMPONENT("color")};`,
    "dist/vlib.d.ts": `export declare const VBtn: ${VUE_COMPONENT("color")};`,
  });

  it("reads the declarations beside a JavaScript subpath, and ranks bundles last", () => {
    expect(findEntryPoints(dir, vuetifyLike).map((e) => e.importPath)).toEqual(["vlib", "vlib/styles", "vlib/components", "vlib/dist/vlib.js"]);
    const { components } = extractComponents(findEntryPoints(dir, vuetifyLike), "vue");
    expect(components).toEqual([expect.objectContaining({ name: "VBtn", importPath: "vlib/components" })]);
    expect(components[0].props.map((p) => p.name)).toEqual(["color"]);
  });

  it("expands wildcard subpaths only when asked to look deeper", () => {
    expect(findEntryPoints(dir, vuetifyLike, { deep: true }).map((e) => e.importPath)).toContain("vlib/components/VBtn");
  });

  it("names default exports from wildcard subpaths and imports them as defaults", () => {
    const pkg = { name: "plib", version: "4.0.0", exports: { ".": { types: "./index.d.ts" }, "./*": { types: "./*/index.d.ts" } } };
    const deepDir = pkgDir({
      "package.json": pkg,
      "index.d.ts": "export declare const version: string;",
      "button/index.d.ts": `declare const Button: ${VUE_COMPONENT("label")};\nexport default Button;`,
      "input-text/index.d.ts": `declare const _default: ${VUE_COMPONENT("value")};\nexport default _default;`,
      "config/index.d.ts": "export declare const config: object;",
    });
    expect(extractComponents(findEntryPoints(deepDir, pkg), "vue").components).toEqual([]);
    const { components } = extractComponents(findEntryPoints(deepDir, pkg, { deep: true }), "vue");
    expect(components.map((c) => [c.name, c.importPath, c.defaultExport])).toEqual([
      ["Button", "plib/button", true],
      ["InputText", "plib/input-text", true],
    ]);
    expect(vueKit.usage(components[0])).toBe('import Button from "plib/button"; <Button />');
  });

  it("finds a stylesheet exported under a subpath without a .css extension", () => {
    expect(detectCss(dir, vuetifyLike)).toEqual(["vlib/styles"]);
  });
});

describe("Vue presets", () => {
  const base = (setup: DesignSystem["setup"]): DesignSystem => ({
    id: "x", name: "X", framework: "vue", packageName: "x", version: "1.0.0", source: { kind: "npm", spec: "x" },
    dependencySpec: "^1.0.0", setup, components: [], guidelines: "", tokens: [], importedAt: 0, warnings: [], hasAuthToken: false,
  });

  it("sets Vuetify up with its plugin, styles, icons and <VApp> root", () => {
    const setup = vuePreset("vuetify", "3.9.0")!.setup;
    const file = vueSetup(base({ globalCss: setup.globalCss!, provider: setup.provider, vuePlugin: setup.vuePlugin, extraDependencies: {} }));
    expect(file).toContain('import "vuetify/styles";');
    expect(file).toContain('import { createVuetify } from "vuetify";');
    expect(file).toContain("app.use(createVuetify());");
    expect(file).toContain("h(VApp, null, slots)");
  });

  it("imports the PrimeVue plugin and theme as defaults", () => {
    const setup = vuePreset("primevue", "5.0.4")!.setup;
    expect(setup.extraDependencies).toEqual({ "@primeuix/themes": "^3.0.0" });
    const file = vueSetup(base({ globalCss: [], vuePlugin: setup.vuePlugin, extraDependencies: {} }));
    expect(file).toContain('import { default as PrimeVue } from "primevue/config";');
    expect(file).toContain('import { default as Aura } from "@primeuix/themes/aura";');
    expect(file).toContain("app.use(PrimeVue, { theme: { preset: Aura } });");
  });
});

describe("noComponentsMessage", () => {
  const pkg = { name: "acme", version: "2.0.0" };
  it("explains missing declarations and what was read", () => {
    expect(noComponentsMessage(pkg, ["vue"], [], false)).toMatch(/does not publish TypeScript declarations/);
    const msg = noComponentsMessage(pkg, ["vue", "angular", "react"], [{ file: "/x", importPath: "acme" }], false);
    expect(msg).toContain("No Vue, Angular or React components were found in acme@2.0.0.");
    expect(msg).toContain("Read 1 declaration file(s): acme.");
    expect(noComponentsMessage(pkg, ["react"], [{ file: "/x", importPath: "acme" }], true)).toContain('"Detect automatically"');
  });
});
