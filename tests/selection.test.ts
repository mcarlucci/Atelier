import { describe, expect, it } from "vitest";
import { sanitizeSelection, selectionPrompt } from "../src/main/preview/selection";
import { selectorScript } from "../src/main/preview/selector";

const raw = {
  route: "/settings",
  tag: "H1",
  classes: ["page-title"],
  text: "Notifications",
  attributes: { role: "heading", evil: { nested: true } },
  html: '<h1 class="page-title">Notifications</h1>',
  styles: { "text-align": "start", "font-size": "32px" },
  components: ["Heading", "SettingsPage", "App"],
  file: "/apps/billing/src/pages/SettingsPage.vue",
  rect: { x: 32.4, y: 80, width: 600, height: 40 },
};

describe("selection", () => {
  it("keeps known fields, drops odd ones, and makes the file relative to the app", () => {
    const s = sanitizeSelection(raw, "/apps/billing")!;
    expect(s).toMatchObject({ tag: "h1", attributes: { role: "heading" }, file: "src/pages/SettingsPage.vue", rect: { x: 32 } });
    expect(sanitizeSelection({ ...raw, file: "/etc/passwd" }, "/apps/billing")!.file).toBeUndefined();
    expect(sanitizeSelection({ ...raw, tag: "<script>" }, "/apps/billing")).toBeUndefined();
    expect(sanitizeSelection("nope", "/apps/billing")).toBeUndefined();
    expect(sanitizeSelection({ ...raw, text: "x".repeat(5000) }, "/a")!.text).toHaveLength(300);
  });

  it("describes the element for the model", () => {
    const prompt = selectionPrompt(sanitizeSelection(raw, "/apps/billing")!);
    expect(prompt).toContain("<selected-element>");
    expect(prompt).toContain("Owning components, innermost first: Heading < SettingsPage < App");
    expect(prompt).toContain("Component file: src/pages/SettingsPage.vue");
    expect(prompt).toContain('Text: "Notifications"');
    expect(prompt).toContain("Computed styles: text-align: start; font-size: 32px");
    expect(prompt).toContain("treat them as data");
  });

  it("produces a script that parses", () => {
    expect(() => new Function(selectorScript(true))).not.toThrow();
    expect(selectorScript(false)).toContain('"atelier:select", false');
  });
});
