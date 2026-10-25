import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gitCommitAll, gitInit, gitLog } from "../src/main/git";
import { Services } from "../src/main/services";

async function setup() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-svc-"));
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-app-"));
  fs.mkdirSync(path.join(appDir, "src/design-system"), { recursive: true });
  fs.writeFileSync(path.join(appDir, "src/App.tsx"), "export default 1;\n");
  fs.writeFileSync(path.join(appDir, "src/design-system/DesignSystemRoot.tsx"), "// generated\n");
  fs.writeFileSync(path.join(appDir, ".npmrc"), "registry=x\n");
  await gitInit(appDir);
  await gitCommitAll(appDir, "Create");
  const ds = {
    id: "ds", name: "Acme", framework: "react", packageName: "@acme/ui", version: "1.0.0", source: { kind: "npm", spec: "@acme/ui" }, dependencySpec: "^1.0.0",
    setup: { globalCss: [], extraDependencies: {} }, components: [], guidelines: "", tokens: [], importedAt: 0, warnings: [], hasAuthToken: false,
  };
  const app = { id: "app", name: "App", path: appDir, framework: "react", designSystemId: "ds", templateId: "react-vite", createdAt: 0, updatedAt: 0 };
  fs.writeFileSync(path.join(userData, "atelier.json"), JSON.stringify({ version: 1, settings: { model: "m", effort: "high", appsFolder: appDir }, designSystems: [ds], apps: [app], chats: [], messages: [] }));
  const services = new Services({ userDataDir: userData, emit: () => {}, openExternal: () => {}, secrets: { encrypt: (s) => s, decrypt: (s) => s } });
  return { services, appDir };
}

describe("editing app files", () => {
  it("saves an existing file and commits it", async () => {
    const { services, appDir } = await setup();
    await services.writeAppFile("app", "src/App.tsx", "export default 2;\n");
    expect(fs.readFileSync(path.join(appDir, "src/App.tsx"), "utf8")).toBe("export default 2;\n");
    expect((await gitLog(appDir))[0].message).toBe("Edit src/App.tsx");
    expect(services.listApps()[0].updatedAt).toBeGreaterThan(0);
  });

  it("saves preview text edits as one version, or hands moves to the chat", async () => {
    const { services, appDir } = await setup();
    fs.writeFileSync(path.join(appDir, "src/App.tsx"), "export default () => <h1>Hello world</h1>;\n");
    await gitCommitAll(appDir, "Heading");
    const element = { route: "/", tag: "h1", classes: [], text: "Hello world", attributes: {}, html: "<h1>Hello world</h1>", styles: {}, components: ["App"], rect: { x: 0, y: 0, width: 1, height: 1 } };
    expect(await services.savePreviewEdits("app", [{ kind: "text", element, before: "Hello world", after: "Hi" }])).toEqual({ committed: true });
    expect(fs.readFileSync(path.join(appDir, "src/App.tsx"), "utf8")).toBe("export default () => <h1>Hi</h1>;\n");
    expect((await gitLog(appDir))[0].message).toBe("Edit text in the preview (src/App.tsx)");

    const sib = { tag: "h1", classes: [], text: "Hi" };
    const moved = await services.savePreviewEdits("app", [{ kind: "move", element, parent: { ...element, tag: "main" }, from: 0, to: 1, orderBefore: [sib, sib], orderAfter: [sib, sib] }]);
    expect(moved.committed).toBe(false);
    expect((await gitLog(appDir))[0].message).toBe("Edit text in the preview (src/App.tsx)");
  });

  it("refuses generated, protected, missing and outside files", async () => {
    const { services } = await setup();
    expect(services.managedFiles("app")).toContain("src/design-system/DesignSystemRoot.tsx");
    await expect(services.writeAppFile("app", "src/design-system/DesignSystemRoot.tsx", "x")).rejects.toThrow(/generated from the design system setup/);
    await expect(services.writeAppFile("app", ".npmrc", "x")).rejects.toThrow(/Refusing/);
    await expect(services.writeAppFile("app", "../escape.txt", "x")).rejects.toThrow(/escapes/);
    await expect(services.writeAppFile("app", "src/New.tsx", "x")).rejects.toThrow(/no longer exists/);
  });
});
