import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { providerPreset } from "@shared/providers";
import { describeProviderError, listModels, ProviderHttpError, streamTurn, stripThinking, type ProviderTarget } from "../src/main/chat/providers";
import { Services } from "../src/main/services";

/** A streamed response whose body arrives in the given pieces, split at awkward places on purpose. */
function streamed(pieces: string[], init: ResponseInit = {}): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of pieces) c.enqueue(enc.encode(p));
      c.close();
    },
  });
  return new Response(body, { status: 200, ...init });
}

function target(id: "ollama" | "openrouter" | "lmstudio", extra: Partial<ProviderTarget> = {}): ProviderTarget {
  const preset = providerPreset(id);
  return { preset, baseUrl: preset.defaultBaseUrl, model: "test-model", effort: "high", ...extra };
}

afterEach(() => vi.unstubAllGlobals());

describe("stripThinking", () => {
  it("removes closed think blocks", () => {
    expect(stripThinking("<think>plan</think>\nHello", false)).toBe("Hello");
  });
  it("holds back an unclosed block and a partial tag while streaming", () => {
    expect(stripThinking("Hi <think>still going", true)).toBe("Hi ");
    expect(stripThinking("Hi <thi", true)).toBe("Hi ");
    expect(stripThinking("a < b", true)).toBe("a < b");
  });
});

describe("OpenAI-compatible streaming", () => {
  it("parses server-sent events split across chunks and hides reasoning", async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"<think>hm"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"m</think>Hel"}}]}\n\ndata: {"choices":[{"delta":{"con',
      'tent":"lo"},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\ndata: [DONE]\n\n',
    ];
    const fetchMock = vi.fn(async () => streamed(events));
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];
    const result = await streamTurn(target("openrouter", { apiKey: "sk-test" }), {
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      signal: new AbortController().signal,
      onText: (d) => deltas.push(d),
    });
    expect(result).toEqual({ text: "Hello", stopReason: "end_turn", usage: { input: 12, output: 3, cacheRead: 0 } });
    expect(deltas.join("")).toBe("Hello");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body as string).messages[0]).toEqual({ role: "system", content: "sys" });
  });

  it("maps a length finish to max_tokens", async () => {
    vi.stubGlobal("fetch", async () => streamed(['data: {"choices":[{"delta":{"content":"x"},"finish_reason":"length"}]}\n\n']));
    const r = await streamTurn(target("lmstudio"), { system: "", messages: [], signal: new AbortController().signal, onText: () => {} });
    expect(r.stopReason).toBe("max_tokens");
  });

  it("raises HTTP errors with the provider's message", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }));
    const t = target("openrouter", { apiKey: "x" });
    const err = await streamTurn(t, { system: "", messages: [], signal: new AbortController().signal, onText: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(describeProviderError(err, t)).toMatch(/rejected the API key/);
  });
});

describe("Ollama", () => {
  it("streams NDJSON from /api/chat with the configured context length", async () => {
    const fetchMock = vi.fn(async () =>
      streamed(['{"message":{"content":"Hel"},"done":false}\n{"message":{"con', 'tent":"lo"},"done":false}\n', '{"done":true,"done_reason":"stop","prompt_eval_count":5,"eval_count":2}\n']),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await streamTurn(target("ollama", { contextLength: 65536 }), { system: "s", messages: [], signal: new AbortController().signal, onText: () => {} });
    expect(r).toEqual({ text: "Hello", stopReason: "end_turn", usage: { input: 5, output: 2, cacheRead: 0 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/chat");
    expect(JSON.parse(init.body as string).options).toEqual({ num_ctx: 65536 });
  });

  it("lists installed models from /api/tags", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ models: [{ name: "qwen" }, { name: "llama" }] })));
    expect(await listModels(target("ollama"))).toEqual(["llama", "qwen"]);
  });

  it("explains an unreachable local server", () => {
    const err = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    expect(describeProviderError(err, target("ollama"))).toMatch(/Make sure it is running/);
  });

  it("returns the error on list instead of throwing", async () => {
    vi.stubGlobal("fetch", async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    });
    const s = new Services({
      userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "atelier-llm-")),
      emit: () => {},
      openExternal: () => {},
      secrets: { encrypt: (v) => v, decrypt: (v) => v },
    });
    const listed = await s.listProviderModels("ollama");
    expect(listed.models).toEqual([]);
    expect(listed.error).toMatch(/Make sure it is running/);
  });
});
