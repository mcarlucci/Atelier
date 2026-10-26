import { describe, expect, it } from "vitest";
import { findKeychainKey, readKeychainKey } from "../src/main/credential-store";
import type { RunResult } from "../src/main/process";

const KEY = "sk-ant-api03-abc123";
const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
const missing: RunResult = { code: 44, stdout: "", stderr: "not found" };

/** Fake `security` with one item, recording every call. */
function mac(items: Record<string, string>) {
  const calls: string[][] = [];
  const runner = async (_cmd: string, args: string[]) => {
    calls.push(args);
    const value = items[args[args.indexOf("-s") + 1]];
    return value === undefined ? missing : ok(args.includes("-w") ? `${value}\n` : "attributes");
  };
  return { runner, calls };
}

describe("macOS keychain", () => {
  it("detects an item without reading its secret", async () => {
    const { runner, calls } = mac({ anthropic: KEY });
    expect(await findKeychainKey("darwin", runner)).toEqual({ found: true, source: "Keychain" });
    expect(calls.flat()).not.toContain("-w");
  });

  it("reports nothing when no item exists", async () => {
    expect(await findKeychainKey("darwin", mac({}).runner)).toEqual({ found: false });
  });

  it("reads and trims the key", async () => {
    expect(await readKeychainKey("darwin", mac({ ANTHROPIC_API_KEY: KEY }).runner)).toBe(KEY);
  });

  it("skips values that are not Anthropic keys", async () => {
    expect(await readKeychainKey("darwin", mac({ Atelier: "hunter2", anthropic: KEY }).runner)).toBe(KEY);
    expect(await readKeychainKey("darwin", mac({ anthropic: "hunter2" }).runner)).toBeUndefined();
  });

  it("treats a missing tool as not found", async () => {
    const runner = async () => {
      throw new Error("ENOENT");
    };
    expect(await findKeychainKey("darwin", runner)).toEqual({ found: false });
    expect(await readKeychainKey("darwin", runner)).toBeUndefined();
  });
});

describe("Windows Credential Manager", () => {
  const win = (blob: Buffer | undefined) => async (_cmd: string, _args: string[], options?: { env?: NodeJS.ProcessEnv }) =>
    blob && options?.env?.ATELIER_CRED_TARGET === "anthropic" ? ok(options.env.ATELIER_CRED_READ === "1" ? blob.toString("base64") : "") : missing;

  it("detects without output, then decodes UTF-16 and UTF-8 blobs", async () => {
    expect(await findKeychainKey("win32", win(Buffer.from(KEY, "utf16le")))).toEqual({ found: true, source: "Credential Manager" });
    expect(await readKeychainKey("win32", win(Buffer.from(KEY, "utf16le")))).toBe(KEY);
    expect(await readKeychainKey("win32", win(Buffer.from(KEY, "utf8")))).toBe(KEY);
  });

  it("rejects other values", async () => {
    expect(await readKeychainKey("win32", win(Buffer.from("hunter2", "utf16le")))).toBeUndefined();
  });
});

it("does nothing on other platforms", async () => {
  const { runner, calls } = mac({ anthropic: KEY });
  expect(await findKeychainKey("linux", runner)).toEqual({ found: false });
  expect(await readKeychainKey("linux", runner)).toBeUndefined();
  expect(calls).toHaveLength(0);
});
