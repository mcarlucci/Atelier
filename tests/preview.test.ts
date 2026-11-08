import { describe, expect, it } from "vitest";
import { classifyPreview } from "../src/main/preview/check";
import type { ConsoleEntry, PreviewPage } from "../src/main/preview/page";
import { createPreviewToolset } from "../src/main/preview/tools";

const page = (over: Partial<PreviewPage> = {}): PreviewPage => ({
  screenshot: async () => Buffer.from("jpeg"),
  evaluate: async () => ({}) as never,
  messages: () => [],
  close: () => {},
  ...over,
});

describe("classifyPreview", () => {
  it("is healthy with text and no errors", () => {
    expect(classifyPreview({ text: 40, media: 0, overlay: null }, [])).toEqual({ ok: true, blank: false, errors: [] });
  });

  it("is blank when there is no text and nothing visual", () => {
    expect(classifyPreview({ text: 0, media: 0, overlay: null }, []).blank).toBe(true);
    expect(classifyPreview({ text: 0, media: 3, overlay: null }, []).blank).toBe(false);
  });

  it("reports console errors once, ignoring noise, and a build overlay first", () => {
    const messages: ConsoleEntry[] = [
      { level: "error", text: "Failed to load favicon.ico" },
      { level: "error", text: "Uncaught TypeError: x is undefined" },
      { level: "error", text: "Uncaught TypeError: x is undefined" },
      { level: "warning", text: "key prop" },
    ];
    const r = classifyPreview({ text: 5, media: 0, overlay: "Failed to resolve import" }, messages);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(["Build error: Failed to resolve import", "Uncaught TypeError: x is undefined"]);
  });
});

describe("preview tools", () => {
  it("opens the page once, returns a screenshot image and inspects", async () => {
    let opened = 0;
    const scripts: string[] = [];
    const { toolset, close } = createPreviewToolset(
      async () => {
        opened++;
        return page({ evaluate: async (s) => (scripts.push(s), { title: "Home", text: "Hello" }) as never });
      },
      async () => "ok",
    );
    const shot = await toolset.call("preview_screenshot", { width: 390 }, new AbortController().signal);
    expect(shot.images).toHaveLength(1);
    expect(shot.text).toContain("390");
    const inspected = await toolset.call("preview_inspect", { selector: "#root" }, new AbortController().signal);
    expect(inspected.text).toContain("Hello");
    expect(scripts[0]).toContain('"#root"');
    expect(opened).toBe(1);
    close();
  });

  it("reports console errors, and 'none' when clean", async () => {
    const dirty = createPreviewToolset(async () => page({ messages: () => [{ level: "error", text: "boom" }], evaluate: async () => null as never }), async () => "");
    expect((await dirty.toolset.call("preview_console", {}, new AbortController().signal)).text).toContain("error: boom");
    const clean = createPreviewToolset(async () => page({ evaluate: async () => null as never }), async () => "");
    expect((await clean.toolset.call("preview_console", {}, new AbortController().signal)).text).toContain("No console errors");
  });

  it("refuses a click or type without a target, and turns page errors into tool errors", async () => {
    const { toolset } = createPreviewToolset(async () => page({ evaluate: async () => ({ error: "Nothing to click matches that." }) as never }), async () => "");
    expect((await toolset.call("preview_click", {}, new AbortController().signal)).isError).toBe(true);
    expect((await toolset.call("preview_click", { text: "Save" }, new AbortController().signal)).isError).toBe(true);
    expect((await toolset.call("preview_type", { text: "x" }, new AbortController().signal)).isError).toBe(true);
  });

  it("runs the Invariant browser checks", async () => {
    const { toolset } = createPreviewToolset(async () => page(), async () => "Browser checks: 3 passed");
    expect((await toolset.call("preview_run_checks", {}, new AbortController().signal)).text).toContain("3 passed");
  });
});
