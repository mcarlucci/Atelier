import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { callFigmaTool, parseFigmaUrl } from "../src/main/connectors/figma";
import { toOutput } from "../src/main/connectors/manager";
import { ConnectorService, toolName } from "../src/main/connectors/service";
import { Store } from "../src/main/store";

const FIXTURE = path.join(__dirname, "fixtures/mcp-server.mjs");
const services: ConnectorService[] = [];

function makeService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-conn-"));
  const store = new Store(path.join(dir, "atelier.json"), { model: "m", effort: "high", appsFolder: dir });
  const service = new ConnectorService({
    store,
    // Reversible stand-in for safeStorage.
    secrets: { encrypt: (s) => Buffer.from(s).toString("base64"), decrypt: (s) => Buffer.from(s, "base64").toString() },
    openExternal: () => {},
    onChange: () => {},
    designSystemExists: (id) => id === "ds-1",
  });
  services.push(service);
  return { service, store };
}

afterAll(async () => {
  await Promise.all(services.map((s) => s.manager.closeAll()));
});
afterEach(() => vi.unstubAllGlobals());

describe("figma links", () => {
  it("parses design, file and branch links with node ids", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/AbC123/My-File?node-id=12-34&t=x")).toEqual({ fileKey: "AbC123", nodeId: "12:34" });
    expect(parseFigmaUrl("https://figma.com/file/XYZ/Old")).toEqual({ fileKey: "XYZ", nodeId: undefined });
    expect(parseFigmaUrl("https://www.figma.com/design/MAIN/branch/BR1/File?node-id=1-2")).toEqual({ fileKey: "BR1", nodeId: "1:2" });
  });
  it("rejects other hosts", () => {
    expect(() => parseFigmaUrl("https://evil.example/design/AbC")).toThrow(/figma.com/);
    expect(() => parseFigmaUrl("https://figma.com.evil.example/design/AbC")).toThrow(/figma.com/);
  });
  it("simplifies a node tree and names component instances", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        name: "App",
        nodes: {
          "1:2": {
            components: { "9:9": { name: "Button" } },
            document: {
              id: "1:2",
              name: "Settings",
              type: "FRAME",
              absoluteBoundingBox: { width: 390, height: 844 },
              layoutMode: "VERTICAL",
              itemSpacing: 16,
              fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
              children: [
                { id: "2", name: "Title", type: "TEXT", characters: "Notifications", style: { fontSize: 24, fontWeight: 600 } },
                { id: "3", name: "Save", type: "INSTANCE", componentId: "9:9", children: [{ id: "4", name: "inner", type: "TEXT" }] },
                { id: "5", name: "Hidden", type: "TEXT", visible: false },
              ],
            },
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await callFigmaTool("figd_x", "get_design", { url: "https://www.figma.com/design/K/F?node-id=1-2" }, new AbortController().signal);
    const tree = JSON.parse(out.text).tree;
    expect(tree).toMatchObject({ name: "Settings", size: "390x844", fill: "#ffffff", layout: { direction: "column", gap: 16 } });
    expect(tree.children).toEqual([
      { name: "Title", type: "TEXT", text: "Notifications", font: "24/600" },
      { name: "Save", type: "INSTANCE", component: "Button" },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.figma.com/v1/files/K/nodes?ids=1%3A2");
    expect((init.headers as Record<string, string>)["X-Figma-Token"]).toBe("figd_x");
  });
});

describe("tool results", () => {
  it("flattens MCP content to text and images", () => {
    const out = toOutput({
      content: [
        { type: "text", text: "a" },
        { type: "image", data: "AAA", mimeType: "image/png" },
        { type: "image", data: "BBB", mimeType: "image/svg+xml" },
        { type: "resource", resource: { uri: "x://y", text: "doc" } },
      ],
    });
    expect(out).toEqual({ text: "a\n\ndoc", images: [{ mediaType: "image/png", data: "AAA" }], isError: false });
  });
  it("makes provider-safe tool names", () => {
    expect(toolName("Figma desktop", "get_design_context")).toBe("Figma_desktop__get_design_context");
    expect(toolName("Ünïcode!", "a.b")).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});

describe("connector settings", () => {
  it("rejects tokens over plain http to other hosts", async () => {
    const { service } = makeService();
    await expect(service.save({ name: "x", kind: "mcp-http", url: "http://example.com/mcp", auth: "bearer", enabled: true, secret: "t" })).rejects.toThrow(/https/);
    await expect(service.save({ name: "x", kind: "mcp-http", url: "file:///etc/passwd", auth: "none", enabled: true })).rejects.toThrow(/http or https/);
    await expect(service.save({ name: "x", kind: "mcp-stdio", command: "node", auth: "none", enabled: true, env: { "BAD-NAME": "1" } })).rejects.toThrow(/environment/);
  });
  it("never returns secrets in views", async () => {
    const { service } = makeService();
    const v = await service.save({ name: "Figma", kind: "figma-api", auth: "bearer", enabled: true, secret: "figd_secret" });
    expect(v.hasSecret).toBe(true);
    expect(JSON.stringify(v)).not.toContain("figd_secret");
  });
});

describe("stdio MCP server", () => {
  it("connects, applies the read-only default, and calls tools with the saved environment", async () => {
    const { service } = makeService();
    const v = await service.save({
      name: "DS docs",
      kind: "mcp-stdio",
      command: process.execPath,
      args: [FIXTURE],
      env: { DOCS_TOKEN: "abc" },
      auth: "none",
      enabled: true,
      designSystemId: "ds-1",
    });
    const connected = await service.connect(v.id);
    expect(connected.state).toBe("connected");
    expect(connected.tools.map((t) => [t.name, t.enabled])).toEqual([
      ["get_component", true],
      ["publish_tokens", false],
    ]);

    expect((await service.toolsetFor("other-ds")).toolset).toBeUndefined();
    const { toolset, connectors } = await service.toolsetFor("ds-1");
    expect(connectors).toEqual(["DS docs"]);
    expect(toolset!.specs.map((s) => s.name)).toEqual(["DS_docs__get_component"]);
    const out = await toolset!.call("DS_docs__get_component", { name: "Button" }, new AbortController().signal);
    expect(out.text).toBe('Button: use variant="solid" for primary actions. Token: abc');

    service.setTool(v.id, "publish_tokens", true);
    expect((await service.toolsetFor("ds-1")).toolset!.specs).toHaveLength(2);
  }, 30_000);

  it("reports a missing command", async () => {
    const { service } = makeService();
    const v = await service.save({ name: "Bad", kind: "mcp-stdio", command: "definitely-not-a-command-xyz", auth: "none", enabled: true });
    const after = await service.connect(v.id);
    expect(after.state).toBe("error");
    const { warnings, toolset } = await service.toolsetFor("ds-1");
    expect(toolset).toBeUndefined();
    expect(warnings[0]).toMatch(/^Bad connector unavailable/);
  }, 30_000);
});

describe("HTTP MCP server", () => {
  let child: ChildProcess | undefined;
  afterAll(() => child?.kill());

  it("connects with a bearer token and fails without one", async () => {
    const port = await freePort();
    child = spawn(process.execPath, [FIXTURE, "--http", String(port)]);
    await new Promise<void>((resolve, reject) => {
      child!.stdout!.on("data", (d: Buffer) => d.toString().includes("ready") && resolve());
      child!.on("exit", (code) => reject(new Error(`fixture exited ${code}`)));
    });
    const { service } = makeService();
    const url = `http://127.0.0.1:${port}/mcp`;
    const good = await service.save({ name: "Remote", kind: "mcp-http", url, auth: "bearer", secret: "secret-token", enabled: true });
    const ok = await service.connect(good.id);
    expect(ok.state).toBe("connected");
    expect(ok.tools.map((t) => t.name)).toContain("get_component");

    const bad = await service.save({ name: "No token", kind: "mcp-http", url, auth: "none", enabled: true });
    expect((await service.connect(bad.id)).state).toBe("error");
  }, 30_000);
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}
