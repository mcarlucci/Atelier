import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { InvariantRunner, type Exec } from "../src/main/invariant/runner";
import type { NodeRuntime } from "../src/main/node/runtimes";

const node: NodeRuntime = {
  version: "24.0.0",
  source: "system",
  commands: { node: { command: "node", args: [] }, npm: { command: "npm", args: [] }, npx: { command: "npx", args: [] } },
};

function setup(exec: Exec) {
  const toolDir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-tool-"));
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-app-"));
  const runner = new InvariantRunner({ toolDir, node: async () => node, exec });
  const fakeInstall = () => {
    const dir = path.join(toolDir, "node_modules", "invariant-ui");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "0.1.0", bin: { invariant: "cli.js" } }));
  };
  return { runner, appDir, fakeInstall };
}

describe("InvariantRunner", () => {
  it("installs once, then validates and parses JSON", async () => {
    const calls: string[][] = [];
    let fake = () => {};
    const exec: Exec = async (_c, args) => {
      calls.push(args);
      if (args.includes("install")) {
        fake();
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 1, stdout: JSON.stringify({ contractHash: "h", summary: {}, violations: [], evaluations: [] }), stderr: "" };
    };
    const { runner, appDir, fakeInstall } = setup(exec);
    fake = fakeInstall;
    const result = await runner.validate(appDir, ["src/App.tsx"]);
    await runner.validate(appDir, ["src/App.tsx"]);
    expect(result.contractHash).toBe("h");
    expect(calls.filter((a) => a.includes("install"))).toHaveLength(1);
    expect(calls.at(-1)).toContain("--format");
  });

  it("throws on exit code 2", async () => {
    const exec: Exec = async (_c, args) => ({ code: args.includes("install") ? 0 : 2, stdout: "", stderr: "bad usage" });
    const { runner, appDir, fakeInstall } = setup(exec);
    fakeInstall();
    await expect(runner.compile(appDir)).rejects.toThrow(/exit 2/);
  });

  it("writes a config pointing at the design system package", () => {
    const { runner, appDir } = setup(async () => ({ code: 0, stdout: "", stderr: "" }));
    runner.writeConfig(appDir, { packageName: "@acme/ui", framework: "react" }, "demo");
    const cfg = JSON.parse(fs.readFileSync(path.join(appDir, "invariant.config.json"), "utf8"));
    expect(cfg.sources[0]).toMatchObject({ type: "react", path: "node_modules/@acme/ui", declarations: true });
    // Outside the folders the app's dev server watches, or each compile reloads the preview.
    expect(cfg.output.directory).toBe("node_modules/.invariant");
  });

  it("uses the bundled package without installing", async () => {
    const calls: string[][] = [];
    const exec: Exec = async (_c, args) => {
      calls.push(args);
      return { code: 0, stdout: JSON.stringify({ contractHash: "b", summary: {}, violations: [], evaluations: [] }), stderr: "" };
    };
    const bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-bundled-"));
    fs.writeFileSync(path.join(bundledDir, "package.json"), JSON.stringify({ version: "0.1.0", bin: { invariant: "dist/cli/main.js" } }));
    const toolDir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-tool-"));
    const runner = new InvariantRunner({ toolDir, bundledDir, node: async () => node, exec });
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-app-"));
    expect(runner.version()).toBe("0.1.0");
    await runner.validate(appDir, ["a.tsx"]);
    expect(calls.some((a) => a.includes("install"))).toBe(false);
    expect(calls[0][0]).toBe(path.join(bundledDir, "dist/cli/main.js"));
  });

  it("installs Playwright and Chromium once, links it into apps, and refuses browser checks without it", async () => {
    const calls: string[][] = [];
    const toolDir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-tool-"));
    const exec: Exec = async (_c, args) => {
      calls.push(args);
      if (args.includes("install") && args.some((a) => a.startsWith("playwright@"))) {
        fs.mkdirSync(path.join(toolDir, "node_modules", "playwright"), { recursive: true });
        fs.writeFileSync(path.join(toolDir, "node_modules", "playwright", "package.json"), "{}");
      }
      return { code: 0, stdout: "{}", stderr: "" };
    };
    const runner = new InvariantRunner({ toolDir, node: async () => node, exec });
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-app-"));

    expect(runner.playwrightReady()).toBe(false);
    await expect(runner.browserRun(appDir, "http://127.0.0.1:1/")).rejects.toThrow(/Install it from the Compliance tab/);

    await Promise.all([runner.installPlaywright(), runner.installPlaywright()]);
    await runner.installPlaywright();
    expect(runner.playwrightReady()).toBe(true);
    expect(calls.filter((a) => a.some((x) => x.startsWith("playwright@")))).toHaveLength(1);
    expect(calls.some((a) => a.includes("chromium"))).toBe(true);

    runner.linkPlaywright(appDir);
    expect(fs.realpathSync(path.join(appDir, "node_modules", "playwright"))).toBe(fs.realpathSync(path.join(toolDir, "node_modules", "playwright")));
  });
});
