import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkCompliance } from "../src/main/chat/compliance";
import { buildDesignSystemRules, commonProps } from "../src/main/design-system/rules";
import type { DesignSystem } from "../src/shared/types";

const ds: DesignSystem = {
  id: "x", name: "Acme UI", framework: "react", packageName: "@acme/ui", version: "2.0.0",
  source: { kind: "npm", spec: "@acme/ui" }, dependencySpec: "^2.0.0",
  setup: { globalCss: ["@acme/ui/styles.css"], provider: { importName: "AcmeProvider", importPath: "@acme/ui" }, extraDependencies: {} },
  components: [
    { name: "Button", importPath: "@acme/ui", props: [{ name: "variant", type: "'primary' | 'ghost'", required: true }], extendsNative: "button", enabled: true },
    { name: "IconButton", importPath: "@acme/ui", props: [], extendsNative: "button", enabled: true },
    { name: "Dialog.Root", importPath: "@acme/ui", props: [], enabled: true },
    { name: "Secret", importPath: "@acme/ui", props: [], enabled: false },
  ],
  guidelines: "Use one primary button per screen.", tokens: ["--acme-color-brand"], importedAt: 0, warnings: [], hasAuthToken: false,
};

describe("checkCompliance", () => {
  it("flags foreign kits, raw elements and invented components", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-comp-"));
    fs.writeFileSync(path.join(dir, "Page.tsx"), `import { Button, Dialog, Modal } from "@acme/ui";
import type { Fancy } from "@acme/ui";
import { Box } from "@mui/material";
export default () => <div><button>x</button><Button variant="primary" /></div>;
`);
    const issues = checkCompliance(dir, ["Page.tsx"], ds, [".tsx"]);
    expect(issues.map((i) => [i.rule, i.line])).toEqual([
      ["unknown-ds-export", 1],
      ["foreign-ui-library", 3],
      ["native-element", 4],
    ]);
    expect(issues[0].message).toContain("Modal");
  });
});

describe("buildDesignSystemRules", () => {
  it("lists enabled components, guidelines, tokens and native replacements", () => {
    const rules = buildDesignSystemRules(ds);
    expect(rules).toContain("## Button");
    expect(rules).toContain("variant*: 'primary' | 'ghost'");
    expect(rules).not.toContain("Secret");
    expect(rules).toContain("Button instead of <button>");
    expect(rules).toContain("Use one primary button per screen.");
    expect(rules).toContain("--acme-color-brand");
  });

  it("collapses props shared by many components", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `C${i}`, importPath: "x", enabled: true, props: [{ name: "m", type: "string", required: false }, { name: `own${i}`, type: "string", required: false }] }));
    expect(commonProps(many).map((p) => p.name)).toEqual(["m"]);
  });
});
