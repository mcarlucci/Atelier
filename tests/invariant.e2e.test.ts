/**
 * End to end against the real Invariant UI CLI bundled in resources/invariant
 * (npm run fetch-invariant -- --from <invariant/dist-npm>). Skipped when it
 * isn't there. No network and no model: the fixture app has its design system
 * as workspace source, which Invariant can compile.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { InvariantRunner } from "../src/main/invariant/runner";
import { openInvariantToolset } from "../src/main/invariant/mcp";
import type { NodeRuntime } from "../src/main/node/runtimes";
import { Services } from "../src/main/services";

// ATELIER_INVARIANT_DIR points the suite at another build, such as one unpacked from an installer.
const bundledDir = process.env.ATELIER_INVARIANT_DIR ?? path.join(__dirname, "..", "resources", "invariant");
const fetched = fs.existsSync(path.join(bundledDir, "package.json"));
const node: NodeRuntime = {
  version: process.versions.node,
  source: "system",
  commands: { node: { command: process.execPath, args: [] }, npm: { command: "npm", args: [] }, npx: { command: "npx", args: [] } },
};

function fixtureApp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-inv-e2e-"));
  fs.cpSync(path.join(__dirname, "fixtures", "invariant-app"), dir, { recursive: true });
  return dir;
}

function runner() {
  return new InvariantRunner({ toolDir: fs.mkdtempSync(path.join(os.tmpdir(), "atelier-inv-tool-")), bundledDir, node: async () => node });
}

/** The fixture's design system is the workspace package in ds/, not an installed one. */
function compileFixture(r: InvariantRunner, appDir: string) {
  fs.writeFileSync(
    path.join(appDir, "invariant.config.json"),
    JSON.stringify({ name: "fixture", sources: [{ id: "ds", type: "react", path: "ds" }], validation: { failOn: "never" } }),
  );
  return r.compile(appDir);
}

describe.skipIf(!fetched)("Invariant UI end to end", { timeout: 60_000 }, () => {
  // Governance -> Contract compiles an installed design system with the config Atelier writes itself.
  // Releases bundle a pinned Invariant build, so a build that rejects that config breaks the feature.
  it("compiles an installed design system with the config Atelier writes", async () => {
    const r = runner();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-inv-ds-"));
    const pkg = path.join(dir, "node_modules", "@fixture", "ds");
    fs.mkdirSync(path.join(pkg, "dist"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "ds-work", private: true }));
    fs.writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "@fixture/ds", version: "1.0.0", main: "dist/index.js", module: "dist/index.js", types: "dist/index.d.ts", peerDependencies: { react: "*" } }),
    );
    fs.writeFileSync(path.join(pkg, "dist", "index.js"), "export {};\n");
    fs.writeFileSync(
      path.join(pkg, "dist", "index.d.ts"),
      'import * as React from "react";\nexport interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {\n  /** Visual style. */\n  variant?: "primary" | "secondary";\n}\nexport declare const Button: React.ForwardRefExoticComponent<ButtonProps & React.RefAttributes<HTMLButtonElement>>;\nexport default Button;\n',
    );
    r.writeConfig(dir, { packageName: "@fixture/ds", framework: "react" }, "ds-work");
    const counts = await r.compile(dir);
    expect(counts.components).toBeGreaterThanOrEqual(1);
  });

  it("compiles the design system source into a contract", async () => {
    const appDir = fixtureApp();
    const counts = await compileFixture(runner(), appDir);
    expect(counts.components).toBe(1);
    expect(fs.existsSync(path.join(appDir, "invariant", "invariant.contract.json"))).toBe(true);
  });

  it("passes good code and reports real violations in bad code", async () => {
    const r = runner();
    const appDir = fixtureApp();
    await compileFixture(r, appDir);

    const good = await r.validate(appDir, ["src/Good.tsx"]);
    expect(good.violations).toEqual([]);

    const bad = await r.validate(appDir, ["src/Bad.tsx"]);
    const codes = bad.violations.map((v) => v.code);
    expect(codes).toContain("prop-value-not-allowed");
    expect(codes).toContain("component-unknown");
    expect(bad.violations.every((v) => v.file === "src/Bad.tsx" && (v.line ?? 0) > 0)).toBe(true);
    expect(bad.summary.errors).toBeGreaterThanOrEqual(2);
  });

  it("detects a stale contract", async () => {
    const r = runner();
    const appDir = fixtureApp();
    await compileFixture(r, appDir);
    expect(await r.verifyFresh(appDir)).toBe(true);
    // A new public component changes the contract.
    fs.appendFileSync(path.join(appDir, "ds", "src", "Button.tsx"), "\nexport function Extra() {\n  return <div />;\n}\n");
    fs.appendFileSync(path.join(appDir, "ds", "src", "index.ts"), 'export { Extra } from "./Button";\n');
    expect(await r.verifyFresh(appDir)).toBe(false);
  });

  it("serves the contract to the model over MCP", async () => {
    const r = runner();
    const appDir = fixtureApp();
    await compileFixture(r, appDir);
    const opened = await openInvariantToolset(await r.mcpCommand(appDir));
    try {
      const names = opened!.toolset.specs.map((s) => s.name);
      expect(names).toContain("Invariant_UI__get_component");
      expect(names).toContain("Invariant_UI__get_design_patterns");
      const res = await opened!.toolset.call("Invariant_UI__get_component", { name: "Button" }, new AbortController().signal);
      expect(res.isError).toBe(false);
      expect(res.text).toContain("variant");
    } finally {
      await opened?.close();
    }
  });

  const userDataOf = new Map<string, string>();

  /** An Atelier store with one app, whose design system is the npm package @fx/ui. */
  function servicesFor(appDir: string) {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-inv-user-"));
    const ds = {
      id: "ds", name: "Fx", framework: "react", packageName: "@fx/ui", version: "1.0.0", source: { kind: "npm", spec: "@fx/ui" }, dependencySpec: "^1.0.0",
      setup: { globalCss: [], extraDependencies: {} }, components: [], guidelines: "", tokens: [], importedAt: 0, warnings: [], hasAuthToken: false,
    };
    const app = { id: "app", name: "App", path: appDir, framework: "react", designSystemId: "ds", templateId: "react-vite", createdAt: 0, updatedAt: 0 };
    userDataOf.set(appDir, userData);
    fs.writeFileSync(path.join(userData, "atelier.json"), JSON.stringify({ version: 1, settings: { model: "m", effort: "high", appsFolder: appDir }, designSystems: [ds], apps: [app], chats: [], messages: [] }));
    return new Services({ userDataDir: userData, bundledInvariantDir: bundledDir, skipBrowserInstall: true, emit: () => {}, openExternal: () => {}, secrets: { encrypt: (s) => s, decrypt: (s) => s } });
  }

  /** Installs the design system the way npm does: built declaration files in node_modules. */
  function installDesignSystem(appDir: string) {
    const dir = path.join(appDir, "node_modules", "@fx", "ui");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@fx/ui", version: "1.0.0", types: "index.d.ts", peerDependencies: { react: "*" } }));
    fs.copyFileSync(path.join(__dirname, "fixtures", "react-ds", "index.d.ts"), path.join(dir, "index.d.ts"));
  }

  it("compiles an installed npm design system and validates app code against it", async () => {
    const appDir = fixtureApp();
    installDesignSystem(appDir);
    fs.writeFileSync(
      path.join(appDir, "src", "Page.tsx"),
      'import { Button, Card, Mystery } from "@fx/ui";\n\nexport default function Page() {\n  return (\n    <Card title="x">\n      <Button variant="neon">Go</Button>\n      <Mystery />\n    </Card>\n  );\n}\n',
    );
    const services = servicesFor(appDir);

    expect(services.invariantStatus("app")).toMatchObject({ installed: true, compiled: false });
    const status = await services.invariantCompile("app");
    expect(status).toMatchObject({ compiled: true });
    // Output stays out of the folders the app's Vite dev server watches, or compiling reloads the preview.
    expect(fs.existsSync(path.join(appDir, "invariant"))).toBe(false);
    expect(fs.existsSync(path.join(appDir, "node_modules", ".invariant", "invariant.report.html"))).toBe(true);

    const result = await services.invariantValidate("app");
    const codes = result.violations.filter((v) => v.file === "src/Page.tsx").map((v) => v.code);
    expect(codes).toContain("prop-value-not-allowed");
    expect(codes).toContain("component-unknown");
  });

  it("compiles the contract when a design system is imported, and apps get it without compiling", async () => {
    const appDir = fixtureApp();
    const services = servicesFor(appDir);
    // What the importer leaves behind: the package installed in the design system's own folder.
    const dsDir = path.join(userDataOf.get(appDir)!, "design-systems", "ds");
    installDesignSystem(dsDir);
    expect(services.store.get().designSystems[0]?.invariant).toBeUndefined();

    await (services as unknown as { setupGovernance(id: string): Promise<void> }).setupGovernance("ds");
    expect(services.store.get().designSystems[0]?.invariant).toMatchObject({ components: 5 });

    // The app was never compiled by the user, yet has the design system's contract.
    expect(fs.existsSync(path.join(appDir, "node_modules", ".invariant", "invariant.contract.json"))).toBe(true);
    expect(services.invariantStatus("app")).toMatchObject({ compiled: true });
    fs.writeFileSync(path.join(appDir, "src", "Page.tsx"), 'import { Button } from "@fx/ui";\nexport default () => <Button variant="neon">x</Button>;\n');
    const result = await services.invariantValidate("app");
    expect(result.violations.map((v) => v.code)).toContain("prop-value-not-allowed");
  });

  it("recompiles a design system and updates apps that use its contract, but not apps with their own", async () => {
    const appDir = fixtureApp();
    const services = servicesFor(appDir);
    const dsDir = path.join(userDataOf.get(appDir)!, "design-systems", "ds");
    installDesignSystem(dsDir);
    const first = await services.recompileDesignSystem("ds");
    expect(first.invariant).toMatchObject({ components: 5 });
    const marker = path.join(appDir, "node_modules", ".invariant", ".atelier-compile.json");
    expect(JSON.parse(fs.readFileSync(marker, "utf8")).fromDs).toBe(first.invariant!.compiledAt);

    await new Promise((r) => setTimeout(r, 5));
    const second = await services.recompileDesignSystem("ds");
    expect(second.invariant!.compiledAt).toBeGreaterThan(first.invariant!.compiledAt);
    expect(JSON.parse(fs.readFileSync(marker, "utf8")).fromDs).toBe(second.invariant!.compiledAt);

    // A contract the user compiled in the app itself is theirs and stays.
    fs.writeFileSync(marker, JSON.stringify({ components: 5, tokens: 0 }));
    await services.recompileDesignSystem("ds");
    expect(JSON.parse(fs.readFileSync(marker, "utf8")).fromDs).toBeUndefined();
  });

  it("records why when the design system can't be compiled, and doesn't fail", async () => {
    const appDir = fixtureApp();
    const services = servicesFor(appDir);
    await (services as unknown as { setupGovernance(id: string): Promise<void> }).setupGovernance("ds");
    const info = services.store.get().designSystems[0]?.invariant;
    expect(info?.components).toBe(0);
    expect(services.invariantStatus("app").compiled).toBe(false);
  });

  it("gives every app a default browser spec that Invariant accepts", async () => {
    const r = runner();
    const appDir = fixtureApp();
    await compileFixture(r, appDir);
    const spec = r.browserSpecFor(appDir, "http://127.0.0.1:5173/");
    expect(spec).toBe(path.join(appDir, "node_modules", ".invariant", "invariant.browser.json"));
    expect(fs.existsSync(path.join(appDir, "invariant.browser.json"))).toBe(false);
    // Without Playwright the CLI stops at loading it, which is after it has parsed and accepted the spec.
    const err = await r.cli(appDir, ["browser", "run", "--spec", spec, "--url", "http://127.0.0.1:5173/", "--json"]).then(
      () => "",
      (e: Error) => e.message,
    );
    expect(err).not.toMatch(/invalid|not valid JSON|no invariant\.browser\.json/);
    expect(err).toMatch(/Playwright/);
    // The app's own spec wins, and a new URL (a new port) rewrites the default.
    fs.writeFileSync(path.join(appDir, "invariant.browser.json"), "{}");
    expect(r.browserSpecFor(appDir, "http://127.0.0.1:5199/")).toBe(path.join(appDir, "invariant.browser.json"));
  });

  it("explains an empty contract when the design system isn't installed, and refuses to validate", async () => {
    const appDir = fixtureApp();
    const services = servicesFor(appDir);
    const status = await services.invariantCompile("app");
    expect(status.compiled).toBe(false);
    expect(status.message).toMatch(/no components/);
    await expect(services.invariantValidate("app")).rejects.toThrow(/Compile the Invariant contract first/);
  });
});
