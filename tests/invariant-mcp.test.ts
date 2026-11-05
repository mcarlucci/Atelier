import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Toolset } from "../src/main/chat/tools";
import { mergeToolsets, openInvariantToolset } from "../src/main/invariant/mcp";

const out = (text: string) => ({ text, images: [], isError: false });
const set = (name: string, text: string): Toolset => ({
  specs: [{ name, description: "", inputSchema: { type: "object" }, label: name }],
  call: async () => out(text),
});

describe("mergeToolsets", () => {
  it("returns undefined for nothing, the set itself for one", () => {
    const a = set("a", "A");
    expect(mergeToolsets(undefined, undefined)).toBeUndefined();
    expect(mergeToolsets(undefined, a)).toBe(a);
  });

  it("routes calls to the owning set and keeps the first of a duplicate name", async () => {
    const merged = mergeToolsets(set("a", "A1"), set("b", "B"), set("a", "A2"))!;
    expect(merged.specs.map((s) => s.name)).toEqual(["a", "b"]);
    expect((await merged.call("a", {}, new AbortController().signal)).text).toBe("A1");
    expect((await merged.call("b", {}, new AbortController().signal)).text).toBe("B");
  });
});

describe("openInvariantToolset", () => {
  it("lists read-only tools with provider-safe names and calls them", async () => {
    const fixture = path.join(__dirname, "fixtures", "mcp-server.mjs");
    const opened = await openInvariantToolset({ command: process.execPath, args: [fixture], env: { PATH: process.env.PATH ?? "" } });
    try {
      expect(opened?.toolset.specs.map((s) => s.name)).toEqual(["Invariant_UI__get_component"]);
      const res = await opened!.toolset.call("Invariant_UI__get_component", { name: "Button" }, new AbortController().signal);
      expect(res.text).toContain("Button");
    } finally {
      await opened?.close();
    }
  });
});
