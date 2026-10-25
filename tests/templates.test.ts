import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DesignSystem } from "@shared/types";
import { defaultTemplateFor, pickMajor } from "@shared/templates";
import { attrsToObject } from "../src/main/frameworks/vue";
import { buildDesignSystemRules } from "../src/main/design-system/rules";
import { builtinTemplateInfos, parseCommand, runtimeFor } from "../src/main/templates";
import { detectTemplate, validateGitUrl } from "../src/main/templates/custom";
import { TemplateService } from "../src/main/templates/service";
import { Store } from "../src/main/store";

function ds(framework: DesignSystem["framework"], extra: Partial<DesignSystem> = {}): DesignSystem {
  return {
    id: "ds",
    name: "Acme UI",
    framework,
    packageName: "@acme/ui",
    version: "1.0.0",
    source: { kind: "npm", spec: "@acme/ui" },
    dependencySpec: "^1.0.0",
    setup: { globalCss: ["@acme/ui/styles.css"], extraDependencies: {} },
    components: [{ name: "Button", importPath: "@acme/ui", props: [], enabled: true, selector: "acme-button", angularImport: "AcmeButtonModule" }],
    guidelines: "",
    tokens: [],
    importedAt: 0,
    warnings: [],
    hasAuthToken: false,
    ...extra,
  };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "atelier-tpl-"));
const builtin = (id: string) => runtimeFor(builtinTemplateInfos().find((t) => t.id === id)!);
const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), "utf8");

describe("pickMajor", () => {
  const ng = [22, 21, 20, 19, 18, 17];
  it("reads common peer ranges", () => {
    expect(pickMajor("^18.0.0 || ^19.0.0", [19, 18])).toBe(19);
    expect(pickMajor("^18.2.0", [19, 18])).toBe(18);
    expect(pickMajor(">=17.0.0 <19.0.0", ng)).toBe(18);
    expect(pickMajor(">=19.0.0", ng)).toBe(22);
    expect(pickMajor("~20.1.0", ng)).toBe(20);
    expect(pickMajor("19.x", ng)).toBe(19);
    expect(pickMajor("<20.3.0", ng)).toBe(20);
    expect(pickMajor(undefined, ng)).toBe(22);
    expect(pickMajor("*", ng)).toBe(22);
  });
  it("returns undefined when nothing fits", () => {
    expect(pickMajor("^16.0.0", ng)).toBeUndefined();
    expect(pickMajor("^17.0.0", [19, 18])).toBeUndefined();
  });
});

describe("parseCommand", () => {
  it("fills the port, reads leading env assignments and keeps quoted arguments", () => {
    expect(parseCommand('BROWSER=none PORT={port} npx react-scripts start --name "my app"', 32100)).toMatchObject({
      args: ["react-scripts", "start", "--name", "my app"],
      env: { BROWSER: "none", PORT: "32100" },
    });
    expect(parseCommand("npm run dev -- --port {port}", 5).args).toEqual(["run", "dev", "--", "--port", "5"]);
  });
});

describe("built-in templates", () => {
  it("generates React 18 when the design system only supports 18", () => {
    const dir = tmp();
    const warnings = builtin("react-vite").scaffold(dir, ds("react", { peerDependencies: { react: "^18.2.0" } }), "Billing");
    expect(warnings).toEqual([]);
    const pkg = JSON.parse(read(dir, "package.json"));
    expect(pkg.dependencies.react).toBe("^18.0.0");
    expect(pkg.dependencies["@acme/ui"]).toBe("^1.0.0");
    expect(read(dir, "src/design-system/DesignSystemRoot.tsx")).toContain('import "@acme/ui/styles.css";');
  });

  it("warns when no supported version fits", () => {
    const warnings = builtin("react-vite").scaffold(tmp(), ds("react", { peerDependencies: { react: "^16.0.0" } }), "Old");
    expect(warnings[0]).toMatch(/expects react \^16\.0\.0/);
  });

  it("wires a Vue plugin and provider into the generated setup", () => {
    const dir = tmp();
    const vueDs = ds("vue", {
      setup: {
        globalCss: ["@acme/ui/styles.css"],
        extraDependencies: {},
        provider: { importName: "AcmeProvider", importPath: "@acme/ui", props: 'theme="dark" scale={1.1}' },
        vuePlugin: { importName: "createAcme", importPath: "@acme/ui", factory: true, options: "{ ripple: true }" },
      },
    });
    builtin("vue-vite").scaffold(dir, vueDs, "Console");
    const setup = read(dir, "src/design-system/setup.ts");
    expect(setup).toContain('import { createAcme, AcmeProvider } from "@acme/ui";');
    expect(setup).toContain("app.use(createAcme({ ripple: true }));");
    expect(setup).toContain('h(AcmeProvider, { theme: "dark", scale: 1.1 }, slots)');
    expect(read(dir, "src/main.ts")).toContain("installDesignSystem(app);");
  });

  it("generates an Angular app for the design system's major", () => {
    const dir = tmp();
    const ngDs = ds("angular", {
      peerDependencies: { "@angular/core": "^18.0.0" },
      setup: { globalCss: ["@acme/ui/theme.css"], extraDependencies: {}, angularModules: [{ importName: "AcmeRootModule", importPath: "@acme/ui" }] },
    });
    builtin("angular-cli").scaffold(dir, ngDs, "Portal");
    const pkg = JSON.parse(read(dir, "package.json"));
    expect(pkg.dependencies["@angular/core"]).toBe("^18.0.0");
    expect(pkg.devDependencies.typescript).toBe("~5.5.0");
    expect(pkg.dependencies["@angular/animations"]).toBe("^18.0.0");
    expect(read(dir, "src/app/app.component.ts")).toContain("standalone: true");
    expect(read(dir, "src/design-system.css")).toContain('@import "@acme/ui/theme.css";');
    expect(read(dir, "src/app/design-system.ts")).toContain("importProvidersFrom(AcmeRootModule)");
    expect(JSON.parse(read(dir, "angular.json")).projects.app.architect.build.options.styles[0]).toBe("src/design-system.css");
  });

  it("puts the template's stack and setup rules in the prompt", () => {
    const rules = buildDesignSystemRules(ds("angular"), builtin("angular-cli"));
    expect(rules).toContain("src/app/pages/<name>/<name>-page.component.ts");
    expect(rules).toContain("src/app/design-system.ts (root providers)");
    expect(rules).toContain("<acme-button>");
  });
});

describe("matching", () => {
  it("prefers the design system's default, then the built-in template", () => {
    const all = builtinTemplateInfos();
    const custom = { ...all[0], id: "custom-react", source: { kind: "folder" as const, path: "/x" } };
    expect(defaultTemplateFor({ framework: "react" }, [custom, ...all])!.id).toBe("react-vite");
    expect(defaultTemplateFor({ framework: "react", defaultTemplateId: "custom-react" }, [custom, ...all])!.id).toBe("custom-react");
    expect(defaultTemplateFor({ framework: "vue", defaultTemplateId: "custom-react" }, [custom, ...all])!.id).toBe("vue-vite");
  });
  it("rejects a template from another framework", () => {
    const dir = tmp();
    const service = new TemplateService(new Store(path.join(dir, "s.json"), { model: "m", effort: "high", appsFolder: dir }), dir);
    expect(() => service.choose(ds("react"), "angular-cli")).toThrow(/angular template/);
    expect(service.choose(ds("angular")).id).toBe("angular-cli");
  });
});

describe("custom templates", () => {
  function starter(files: Record<string, string>): string {
    const dir = tmp();
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    return dir;
  }

  it("detects a Next.js starter and flags a missing setup import", () => {
    const dir = starter({
      "package.json": JSON.stringify({ name: "acme-shell", dependencies: { next: "15.0.0", react: "^19.0.0" } }),
      "app/layout.tsx": "export default function Layout({ children }) { return children; }",
    });
    const d = detectTemplate(dir);
    expect(d).toMatchObject({ name: "acme-shell", framework: "react", stack: "Next.js", devCommand: "npx next dev -p {port} -H 127.0.0.1" });
    expect(d.warnings[0]).toMatch(/Nothing imports src\/design-system\/DesignSystemRoot.tsx/);
  });

  it("uses atelier.template.json and accepts a wired setup file", () => {
    const dir = starter({
      "package.json": JSON.stringify({ name: "x", dependencies: { vue: "^3.5.0", vite: "^8.0.0" } }),
      "atelier.template.json": JSON.stringify({ name: "Acme Vue shell", setupFile: "src/ds/setup.ts", rules: "Pages live in src/views." }),
      "src/main.ts": 'import { installDesignSystem } from "./ds/setup";',
    });
    const d = detectTemplate(dir);
    expect(d).toMatchObject({ name: "Acme Vue shell", framework: "vue", stack: "Vite", setupFile: "src/ds/setup.ts", rules: "Pages live in src/views.", warnings: [] });
  });

  it("imports a folder, then scaffolds apps with the design system and setup file", async () => {
    const src = starter({
      "package.json": JSON.stringify({ name: "shell", dependencies: { react: "^18.3.0", vite: "^8.0.0" } }),
      "src/main.tsx": 'import DesignSystemRoot from "./design-system/DesignSystemRoot";',
      "node_modules/junk/index.js": "x",
    });
    const dir = tmp();
    const service = new TemplateService(new Store(path.join(dir, "s.json"), { model: "m", effort: "high", appsFolder: dir }), path.join(dir, "templates"));
    const t = await service.import({ kind: "folder", path: src });
    expect(t.warnings).toEqual([]);
    expect(service.files(t.id)).toEqual(["package.json", "src/main.tsx"]);

    const app = tmp();
    const warnings = service.runtime(t.id).scaffold(app, ds("react", { peerDependencies: { react: "^19.0.0" } }), "My App");
    expect(warnings[0]).toMatch(/Acme UI needs React \^19\.0\.0, but the “shell” template uses React 18/);
    expect(service.list().find((x) => x.id === t.id)?.frameworkMajor).toBe(18);
    const pkg = JSON.parse(read(app, "package.json"));
    expect(pkg).toMatchObject({ name: "my-app", dependencies: { react: "^18.3.0", "@acme/ui": "^1.0.0" } });
    expect(fs.existsSync(path.join(app, "src/design-system/DesignSystemRoot.tsx"))).toBe(true);

    expect(() => service.update(t.id, { setupFile: "../escape.ts" })).toThrow(/inside the app/);
    expect(() => service.remove("react-vite")).toThrow(/Built-in/);
  });

  it("only accepts https and ssh git URLs", () => {
    expect(() => validateGitUrl("https://github.com/acme/shell.git")).not.toThrow();
    expect(() => validateGitUrl("git@github.com:acme/shell.git")).not.toThrow();
    expect(() => validateGitUrl("--upload-pack=evil")).toThrow();
    expect(() => validateGitUrl("file:///etc")).toThrow();
  });

  it("converts provider props for Vue", () => {
    expect(attrsToObject('appearance="light" data-x="1" n={2}')).toBe('{ appearance: "light", "data-x": "1", n: 2 }');
    expect(attrsToObject("")).toBe("null");
  });
});

describe("Node.js compatibility", () => {
  it("picks the newest Angular whose CLI runs on the local Node.js", () => {
    const at = (node: string) => {
      const dir = tmp();
      const warnings = builtin("angular-cli").scaffold(dir, ds("angular"), "App", { nodeVersion: node });
      return { major: JSON.parse(read(dir, "package.json")).dependencies["@angular/core"], warnings };
    };
    expect(at("24.11.1")).toEqual({ major: "^21.0.0", warnings: [] });
    expect(at("v24.15.0")).toEqual({ major: "^22.0.0", warnings: [] });
    expect(at("20.10.0").major).toBe("^17.0.0");
  });
  it("explains when the design system needs a newer Node.js", () => {
    const warnings = builtin("angular-cli").scaffold(tmp(), ds("angular", { peerDependencies: { "@angular/core": "^22.0.0" } }), "App", { nodeVersion: "24.11.1" });
    expect(warnings[0]).toMatch(/Angular 22 needs Node\.js .* but this computer has 24\.11\.1/);
  });
});
