import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyFileActions, elideFileBodies, isValidPackageSpec, parseResponse, safeJoin } from "../src/main/chat/actions";

const reply = `I'll add a page.
<atelier-write path="src/pages/About.tsx" description="About page">
\`\`\`tsx
export default function About() { return <h1>About</h1>; }
\`\`\`
</atelier-write>
<atelier-rename from="src/old.ts" to="src/new.ts"></atelier-rename>
<atelier-delete path="src/gone.ts"></atelier-delete>
<atelier-add-dependency packages="date-fns --registry=evil zod@^3"></atelier-add-dependency>
<atelier-command type="restart"></atelier-command>
<atelier-chat-summary>About page</atelier-chat-summary>`;

describe("parseResponse", () => {
  it("parses every tag and strips code fences", () => {
    const { actions, summary } = parseResponse(reply);
    expect(summary).toBe("About page");
    expect(actions.map((a) => a.type)).toEqual(["write", "rename", "delete", "add-dependency", "command"]);
    expect(actions[0]).toMatchObject({ path: "src/pages/About.tsx", content: "export default function About() { return <h1>About</h1>; }\n" });
  });

  it("elides file bodies from history", () => {
    expect(elideFileBodies(reply)).not.toContain("function About");
  });
});

describe("applyFileActions", () => {
  it("applies in order, rejects escapes, managed files and bad packages", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-apply-"));
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src/old.ts"), "old");
    fs.writeFileSync(path.join(root, "src/gone.ts"), "gone");
    const { actions } = parseResponse(reply + `<atelier-write path="../escape.txt">x</atelier-write><atelier-write path="src/design-system/DesignSystemRoot.tsx">x</atelier-write>`);
    const result = applyFileActions(root, actions, ["src/design-system/DesignSystemRoot.tsx"]);
    expect(result.written).toEqual(["src/pages/About.tsx"]);
    expect(result.renamed).toEqual([{ from: "src/old.ts", to: "src/new.ts" }]);
    expect(result.deleted).toEqual(["src/gone.ts"]);
    expect(result.dependencies).toEqual(["date-fns", "zod@^3"]);
    expect(result.commands).toEqual(["restart"]);
    expect(result.errors).toHaveLength(3);
    expect(fs.existsSync(path.join(root, "src/new.ts"))).toBe(true);
    expect(fs.existsSync(path.join(root, "src/gone.ts"))).toBe(false);
  });

  it("guards paths and package specs", () => {
    expect(() => safeJoin("/tmp/app", "/etc/passwd")).toThrow();
    expect(() => safeJoin("/tmp/app", "a/../../x")).toThrow();
    expect(() => safeJoin("/tmp/app", ".git/config")).toThrow();
    expect(isValidPackageSpec("@scope/pkg@1.2.3")).toBe(true);
    expect(isValidPackageSpec("--global")).toBe(false);
  });
});
