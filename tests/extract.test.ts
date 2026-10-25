import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractComponents } from "../src/main/design-system/extract";

const fixture = (name: string) => [{ file: path.join(__dirname, "fixtures", name, "index.d.ts"), importPath: `@acme/${name}` }];

describe("extractComponents", () => {
  it("finds React function, forwardRef, class and compound components", () => {
    const { components } = extractComponents(fixture("react-ds"), "react");
    const names = components.map((c) => c.name);
    expect(names).toEqual(["Button", "Card", "Dialog.Root", "Dialog.Title", "LegacyPanel"]);
    const button = components.find((c) => c.name === "Button")!;
    expect(button.description).toBe("Primary action trigger.");
    expect(button.extendsNative).toBe("button");
    expect(button.props.map((p) => p.name)).toEqual(["variant", "loading", "size"]);
    expect(button.props[0]).toMatchObject({ required: true, type: "'primary' | 'secondary' | 'danger'", description: "Visual emphasis." });
    expect(components.find((c) => c.name === "Card")!.props.map((p) => p.name)).toEqual(["title", "children"]);
  });

  it("reads Angular selectors, inputs, outputs and NgModule ownership", () => {
    const { components } = extractComponents(fixture("angular-ds"), "angular");
    expect(components.map((c) => c.name)).toEqual(["AcmeButtonComponent", "AcmeCardComponent"]);
    const button = components[0];
    expect(button.selector).toBe("acme-button");
    expect(button.angularImport).toBe("AcmeButtonComponent");
    expect(button.events).toEqual(["pressed"]);
    expect(button.props).toEqual([
      expect.objectContaining({ name: "variant", required: true, type: '"primary" | "secondary"' }),
      expect.objectContaining({ name: "disabled", required: false }),
      expect.objectContaining({ name: "size", type: '"sm" | "lg"' }),
    ]);
    const card = components[1];
    expect(card.props[0].name).toBe("title");
    expect(card.angularImport).toBe("AcmeCardModule");
  });

  it("reads Vue $props and turns on* handlers into events", () => {
    const { components } = extractComponents(fixture("vue-ds"), "vue");
    expect(components).toHaveLength(1);
    expect(components[0].props.map((p) => p.name)).toEqual(["label", "kind"]);
    expect(components[0].events).toEqual(["click", "update-value"]);
  });
});
