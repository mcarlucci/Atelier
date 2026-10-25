import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Services } from "../src/main/services";

const services = () =>
  new Services({ userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "atelier-set-")), emit: () => {}, openExternal: () => {}, secrets: { encrypt: (s) => s, decrypt: (s) => s } });
const provider = (s: Services, id: string) => s.getSettings().providers.find((p) => p.id === id)!;

describe("models shown in the prompt", () => {
  it("are kept per provider, Anthropic included, and can be reset", async () => {
    const s = services();
    expect(provider(s, "anthropic").shownModels).toBeUndefined();
    await s.configureProvider("anthropic", { shownModels: ["claude-opus-5-5", " claude-opus-5-5 ", "claude-sonnet-5-5"] });
    await s.configureProvider("ollama", { shownModels: [] });
    expect(provider(s, "anthropic").shownModels).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
    expect(provider(s, "ollama").shownModels).toEqual([]);
    expect(s.getSettings().provider).toBe("anthropic");
    await s.configureProvider("anthropic", { shownModels: null });
    expect(provider(s, "anthropic").shownModels).toBeUndefined();
  });

  it("rejects oversized lists", async () => {
    await expect(services().configureProvider("ollama", { shownModels: ["x".repeat(201)] })).rejects.toThrow(/too long/);
  });
});
