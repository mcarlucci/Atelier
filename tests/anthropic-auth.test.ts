import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectFederatedAuth } from "../src/main/anthropic-auth";

const dirs: string[] = [];
function home(files: Record<string, string> = {}): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-auth-"));
  dirs.push(h);
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(h, ".config", "anthropic", rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  return h;
}
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("detectFederatedAuth", () => {
  it("finds nothing on a clean machine", () => {
    expect(detectFederatedAuth({}, "linux", home())).toBeNull();
  });

  it("finds the default profile on disk", () => {
    expect(detectFederatedAuth({}, "linux", home({ "configs/default.json": "{}" }))).toEqual({ kind: "profile", source: "profile default" });
  });

  it("follows active_config", () => {
    const h = home({ active_config: "work\n", "configs/work.json": "{}" });
    expect(detectFederatedAuth({}, "linux", h)).toEqual({ kind: "profile", source: "profile work" });
  });

  it("ignores an active profile whose config is missing", () => {
    expect(detectFederatedAuth({}, "linux", home({ active_config: "gone", "configs/default.json": "{}" }))).toBeNull();
  });

  it("honors ANTHROPIC_CONFIG_DIR", () => {
    const h = home();
    const dir = path.join(h, "custom");
    fs.mkdirSync(path.join(dir, "configs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "configs", "default.json"), "{}");
    expect(detectFederatedAuth({ ANTHROPIC_CONFIG_DIR: dir }, "linux", h)?.kind).toBe("profile");
  });

  it("detects env-based credentials without reading any file", () => {
    const h = home();
    expect(detectFederatedAuth({ ANTHROPIC_AUTH_TOKEN: "t" }, "linux", h)).toEqual({ kind: "token", source: "ANTHROPIC_AUTH_TOKEN" });
    expect(detectFederatedAuth({ ANTHROPIC_PROFILE: "corp" }, "linux", h)).toEqual({ kind: "profile", source: "profile corp" });
    expect(
      detectFederatedAuth({ ANTHROPIC_FEDERATION_RULE_ID: "r", ANTHROPIC_ORGANIZATION_ID: "o", ANTHROPIC_IDENTITY_TOKEN_FILE: "/t" }, "linux", h)?.kind,
    ).toBe("federation");
    expect(detectFederatedAuth({ ANTHROPIC_FEDERATION_RULE_ID: "r" }, "linux", h)).toBeNull();
  });
});
