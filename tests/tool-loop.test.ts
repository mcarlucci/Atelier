import { afterEach, describe, expect, it, vi } from "vitest";
import { providerPreset } from "@shared/providers";
import { streamTurn, type ProviderTarget } from "../src/main/chat/providers";
import type { Toolset } from "../src/main/chat/tools";

afterEach(() => vi.unstubAllGlobals());

function body(text: string, contentType: string): Response {
  return new Response(text, { status: 200, headers: { "content-type": contentType } });
}

function figmaToolset(): Toolset & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    specs: [{ name: "Figma__get_design", description: "Reads a frame", inputSchema: { type: "object", properties: { url: { type: "string" } } }, label: "Figma · get_design" }],
    call: async (_name, input) => {
      calls.push(input);
      return { text: '{"tree":"Settings"}', images: [{ mediaType: "image/png", data: "AAA" }], isError: false };
    },
  };
}

const sse = (events: object[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");

function anthropicTurn(blocks: object[], deltas: object[], stop: string) {
  return sse([
    {
      type: "message_start",
      message: { id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } },
    },
    ...blocks.flatMap((b, i) => [
      { type: "content_block_start", index: i, content_block: b },
      ...deltas.filter((d) => (d as { index: number }).index === i),
      { type: "content_block_stop", index: i },
    ]),
    { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ]);
}

describe("Anthropic tool loop", () => {
  it("runs tool calls and continues until the model answers", async () => {
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(init.body as string));
        if (requests.length === 1) {
          return body(
            anthropicTurn(
              [
                { type: "text", text: "" },
                { type: "tool_use", id: "toolu_1", name: "Figma__get_design", input: {} },
              ],
              [
                { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Reading the design." } },
                { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"url":"https://figma.com/design/K/F"}' } },
              ],
              "tool_use",
            ),
            "text/event-stream",
          );
        }
        return body(
          anthropicTurn([{ type: "text", text: "" }], [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " Done." } }], "end_turn"),
          "text/event-stream",
        );
      }),
    );
    const toolset = figmaToolset();
    const preset = providerPreset("anthropic");
    const deltas: string[] = [];
    const result = await streamTurn(
      { preset, baseUrl: "", apiKey: "sk-ant-test", model: "claude-opus-5-5", effort: "high" },
      { system: "sys", messages: [{ role: "user", content: "Build https://figma.com/design/K/F" }], signal: new AbortController().signal, onText: (d) => deltas.push(d), toolset },
    );

    expect(toolset.calls).toEqual([{ url: "https://figma.com/design/K/F" }]);
    expect(result.stopReason).toBe("end_turn");
    expect(result.text).toBe('Reading the design.\n<atelier-tool name="Figma · get_design" status="ok">https://figma.com/design/K/F</atelier-tool>\n Done.');
    expect(deltas.join("")).toBe(result.text);
    expect(result.usage.input).toBe(20);

    expect(requests[0].tools).toEqual([{ name: "Figma__get_design", description: "Reads a frame", input_schema: toolset.specs[0].inputSchema }]);
    expect(requests[0].tool_choice).toEqual({ type: "auto" });
    const second = requests[1].messages as { role: string; content: unknown }[];
    expect(second).toHaveLength(3);
    expect(second[1].role).toBe("assistant");
    expect(second[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: [
            { type: "text", text: '{"tree":"Settings"}' },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
          ],
        },
      ],
    });
  });
});

describe("OpenAI-compatible tool loop", () => {
  const target = (): ProviderTarget => ({ preset: providerPreset("openrouter"), baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "m", effort: "high" });

  it("assembles streamed tool calls and sends text-only results", async () => {
    const requests: Record<string, unknown>[] = [];
    const chunk = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(init.body as string));
        if (requests.length === 1) {
          return body(
            chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "Figma__get_design", arguments: '{"url":' } }] } }] }) +
              chunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"https://figma.com/design/K"}' } }] }, finish_reason: "tool_calls" }] }) +
              "data: [DONE]\n\n",
            "text/event-stream",
          );
        }
        return body(chunk({ choices: [{ delta: { content: "Built it." }, finish_reason: "stop" }] }) + "data: [DONE]\n\n", "text/event-stream");
      }),
    );
    const toolset = figmaToolset();
    const result = await streamTurn(target(), { system: "s", messages: [{ role: "user", content: "go" }], signal: new AbortController().signal, onText: () => {}, toolset });
    expect(toolset.calls).toEqual([{ url: "https://figma.com/design/K" }]);
    expect(result.text).toMatch(/<atelier-tool name="Figma · get_design" status="ok">https:\/\/figma.com\/design\/K<\/atelier-tool>\nBuilt it\.$/);
    const msgs = requests[1].messages as Record<string, unknown>[];
    expect(msgs[2]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "Figma__get_design", arguments: '{"url":"https://figma.com/design/K"}' } }],
    });
    expect(msgs[3]).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: '{"tree":"Settings"}\n[1 image(s) omitted: this provider only accepts text tool results]',
    });
  });

  it("retries without tools when the model doesn't support them", async () => {
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(init.body as string));
        if (requests.length === 1) return Response.json({ error: { message: "This model does not support tools" } }, { status: 400 });
        return body(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hi" }, finish_reason: "stop" }] })}\n\n`, "text/event-stream");
      }),
    );
    const result = await streamTurn(target(), { system: "s", messages: [], signal: new AbortController().signal, onText: () => {}, toolset: figmaToolset() });
    expect(requests[1].tools).toBeUndefined();
    expect(result.text).toMatch(/doesn't support tool calls[\s\S]*Hi$/);
  });
});

describe("Ollama tool loop", () => {
  it("runs object-argument tool calls and sends tool messages", async () => {
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(init.body as string));
        if (requests.length === 1) {
          return body(
            `${JSON.stringify({ message: { content: "", tool_calls: [{ function: { name: "Figma__get_design", arguments: { url: "https://figma.com/design/K" } } }] }, done: false })}\n` +
              `${JSON.stringify({ done: true, done_reason: "stop" })}\n`,
            "application/x-ndjson",
          );
        }
        return body(`${JSON.stringify({ message: { content: "Ok" }, done: false })}\n${JSON.stringify({ done: true, done_reason: "stop" })}\n`, "application/x-ndjson");
      }),
    );
    const toolset = figmaToolset();
    const preset = providerPreset("ollama");
    const result = await streamTurn(
      { preset, baseUrl: preset.defaultBaseUrl, model: "qwen", effort: "high" },
      { system: "s", messages: [], signal: new AbortController().signal, onText: () => {}, toolset },
    );
    expect(toolset.calls).toEqual([{ url: "https://figma.com/design/K" }]);
    expect(result.text).toMatch(/Ok$/);
    expect((requests[0].tools as unknown[]).length).toBe(1);
    expect((requests[1].messages as Record<string, unknown>[]).at(-1)).toMatchObject({ role: "tool", tool_name: "Figma__get_design" });
  });
});
