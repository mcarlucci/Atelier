import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DesignSystem } from "@shared/types";
import { templateVersionProblem } from "@shared/templates";
import { angularSetup } from "../src/main/frameworks/angular";
import { angularPreset } from "../src/main/design-system/presets";
import { checkWiring, wireAngularTemplate } from "../src/main/templates/custom";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "atelier-ng-"));
function project(files: Record<string, string>): string {
  const dir = tmp();
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}
const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), "utf8");
const angularJson = (styles: string[]) =>
  JSON.stringify({ projects: { shell: { projectType: "application", architect: { build: { options: { styles } } } }, lib: { projectType: "library", architect: { build: { options: {} } } } } }, null, "\t");
const SETUP = "src/app/design-system.ts";

describe("wiring Angular templates", () => {
  it("wires a bootstrapped NgModule and angular.json, keeping tab indentation", () => {
    const dir = project({
      "angular.json": angularJson(["src/styles.scss"]),
      "src/app/app.module.ts": "import { NgModule } from '@angular/core';\n@NgModule({\n  declarations: [AppComponent],\n  providers: [],\n  bootstrap: [AppComponent]\n})\nexport class AppModule {}\n",
      "src/app/home/home.module.ts": "@NgModule({ providers: [] })\nexport class HomeModule {}\n",
    });
    expect(wireAngularTemplate(dir, SETUP)).toHaveLength(2);
    expect(read(dir, "src/app/app.module.ts")).toMatch(/^import \{ designSystemProviders \} from "\.\/design-system";\n[\s\S]*providers: \[\.\.\.designSystemProviders\],\n  bootstrap/);
    expect(read(dir, "src/app/home/home.module.ts")).not.toContain("designSystemProviders");
    const json = JSON.parse(read(dir, "angular.json"));
    expect(json.projects.shell.architect.build.options.styles).toEqual(["src/design-system.css", "src/styles.scss"]);
    expect(json.projects.lib.architect.build.options.styles).toBeUndefined();
    expect(read(dir, "angular.json")).toContain('\n\t"projects"');
    expect(checkWiring(dir, { framework: "angular", setupFile: SETUP, devCommand: "npx ng serve --port {port}" })).toEqual([]);
    // Idempotent.
    expect(wireAngularTemplate(dir, SETUP)).toEqual([]);
  });

  it("adds providers to a standalone app config, or to an NgModule without any", () => {
    const standalone = project({ "src/app/app.config.ts": "export const appConfig: ApplicationConfig = {\n  providers: [provideRouter(routes)],\n};\n" });
    wireAngularTemplate(standalone, SETUP);
    expect(read(standalone, "src/app/app.config.ts")).toContain("providers: [...designSystemProviders, provideRouter(routes)]");

    const bare = project({ "src/app/app.module.ts": "@NgModule({ declarations: [A], bootstrap: [A] })\nexport class AppModule {}\n" });
    wireAngularTemplate(bare, SETUP);
    expect(read(bare, "src/app/app.module.ts")).toContain("@NgModule({\n  providers: [...designSystemProviders], declarations");
  });
});

describe("Angular design system setup", () => {
  it("sets up PrimeNG's theme to match its version", () => {
    expect(angularPreset("primeng", "22.1.4")?.setup.extraDependencies).toEqual({ "@primeuix/themes": "^3.0.0" });
    expect(angularPreset("primeng", "20.4.0")?.setup.extraDependencies).toEqual({ "@primeuix/themes": "^2.0.0" });
    expect(angularPreset("primeng", "19.1.0")?.setup.angularProviders?.map((p) => p.expression)).toEqual(["provideAnimationsAsync()", "providePrimeNG({ theme: { preset: Aura } })"]);
    expect(angularPreset("@angular/material", "21.0.0")?.setup.globalCss).toEqual(["@angular/material/prebuilt-themes/azure-blue.css"]);
    expect(angularPreset("@acme/ui", "1.0.0")).toBeNull();
  });

  it("generates default and named imports for providers", () => {
    const setup = angularPreset("primeng", "22.1.4")!.setup;
    const ds = { name: "primeng", setup: { globalCss: [], extraDependencies: {}, angularModules: [{ importName: "ButtonModule", importPath: "primeng/button" }], angularProviders: setup.angularProviders } } as unknown as DesignSystem;
    const out = angularSetup(ds);
    expect(out).toContain('import { providePrimeNG } from "primeng/config";');
    expect(out).toContain('import Aura from "@primeuix/themes/aura";');
    expect(out).toContain("= [importProvidersFrom(ButtonModule), providePrimeNG({ theme: { preset: Aura } })];");
  });

  it("flags a custom template on a framework major the design system doesn't support", () => {
    const ds = { name: "primeng", framework: "angular" as const, peerDependencies: { "@angular/core": "^22.1.0" } };
    expect(templateVersionProblem({ name: "shell-app", framework: "angular", frameworkMajor: 19 }, ds)).toMatch(/primeng needs Angular \^22\.1\.0, but the “shell-app” template uses Angular 19/);
    expect(templateVersionProblem({ name: "shell-app", framework: "angular", frameworkMajor: 22 }, ds)).toBeNull();
    expect(templateVersionProblem({ name: "Angular CLI", framework: "angular" }, ds)).toBeNull();
  });
});
