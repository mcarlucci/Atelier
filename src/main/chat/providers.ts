/**
 * Provider dispatch for a build turn. Anthropic stays on its SDK (llm.ts).
 * Ollama uses its native /api/chat, because its OpenAI-compatible endpoint
 * cannot raise the context window and would silently cut off the design
 * system catalog and codebase. Every other provider uses the OpenAI-compatible
 * /chat/completions endpoint with server-sent events.
 */
import type { EffortLevel } from "@shared/types";
import { DEFAULT_OLLAMA_CONTEXT, type ProviderPreset } from "@shared/providers";
import { describeApiError, MODELS, streamBuildTurn, type StreamResult } from "./llm";
import { isToolsUnsupported, MAX_TOOL_ROUNDS, runTool, toolMarker, TOOLS_UNSUPPORTED_NOTE, type ToolOutput, type Toolset } from "./tools";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ProviderTarget {
  preset: ProviderPreset;
  baseUrl: string;
  apiKey?: string;
  model: string;
  effort: EffortLevel;
  contextLength?: number;
}

export interface TurnRequest {
  system: string;
  messages: ChatTurn[];
  signal: AbortSignal;
  onText(delta: string): void;
  toolset?: Toolset;
}

/** An HTTP failure from a non-Anthropic provider. */
export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function streamTurn(target: ProviderTarget, req: TurnRequest): Promise<StreamResult> {
  if (!target.model) throw new Error(`Choose a ${target.preset.label} model in Settings first.`);
  switch (target.preset.kind) {
    case "anthropic":
      return streamBuildTurn({ apiKey: target.apiKey ?? "", model: target.model, effort: target.effort, ...req });
    case "ollama":
      return streamOllama(target, req);
    default:
      return streamOpenAI(target, req);
  }
}

export async function listModels(target: ProviderTarget, signal?: AbortSignal): Promise<string[]> {
  switch (target.preset.kind) {
    case "anthropic":
      return MODELS.map((m) => m.id);
    case "ollama": {
      const body = (await getJson(joinUrl(target.baseUrl, "/api/tags"), target, signal)) as { models?: { name: string }[] };
      return (body.models ?? []).map((m) => m.name).sort();
    }
    default: {
      const body = (await getJson(joinUrl(target.baseUrl, "/models"), target, signal)) as { data?: { id: string }[] };
      // Gemini's compatibility layer prefixes ids with "models/", which its chat endpoint also accepts bare.
      return (body.data ?? []).map((m) => m.id.replace(/^models\//, "")).sort();
    }
  }
}

export function describeProviderError(err: unknown, target: ProviderTarget): string {
  if (target.preset.kind === "anthropic") return describeApiError(err);
  const label = target.preset.label;
  if (err instanceof ProviderHttpError) {
    if (err.status === 401 || err.status === 403) return `${label} rejected the API key. Update it in Settings.`;
    if (err.status === 404) return `${label} has no model “${target.model}” at ${target.baseUrl}. Pick another model in Settings. (${err.message})`;
    if (err.status === 429) return `${label} rate limited the request. Wait a moment and try again. (${err.message})`;
    return `${label} error (${err.status}): ${err.message}`;
  }
  const cause = (err as { cause?: { code?: string } })?.cause?.code;
  if (cause === "ECONNREFUSED" || cause === "ENOTFOUND" || cause === "ECONNRESET" || (err instanceof TypeError && /fetch failed/i.test(err.message))) {
    return target.preset.local
      ? `Could not reach ${label} at ${target.baseUrl}. Make sure it is running.`
      : `Could not reach ${label} at ${target.baseUrl}. Check your network or the base URL.`;
  }
  return err instanceof Error ? err.message : String(err);
}

// ------------------------------------------------------------ OpenAI-compatible

type OpenAIToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type OpenAIMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

async function streamOpenAI(target: ProviderTarget, req: TurnRequest): Promise<StreamResult> {
  const out = new VisibleText(req.onText);
  const usage = { input: 0, output: 0, cacheRead: 0 };
  const messages: OpenAIMessage[] = [{ role: "system", content: req.system }, ...req.messages];
  let tools = functionTools(req.toolset);

  for (let round = 0; ; round++) {
    const lastRound = round >= MAX_TOOL_ROUNDS;
    const res = await fetch(joinUrl(target.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: { ...headers(target), "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        model: target.model,
        stream: true,
        stream_options: { include_usage: true },
        messages,
        ...(tools.length ? { tools, tool_choice: lastRound ? "none" : "auto" } : {}),
      }),
      signal: req.signal,
    });
    if (!res.ok && tools.length) {
      const err = await httpError(res);
      if (!isToolsUnsupported(err.status, err.message)) throw err;
      // This model can't take tools: answer without them.
      tools = [];
      out.push(TOOLS_UNSUPPORTED_NOTE);
      round--;
      continue;
    }
    await assertOk(res);

    const before = out.final().length;
    const calls: OpenAIToolCall[] = [];
    let finish: string | null = null;
    for await (const data of sseData(res)) {
      if (data === "[DONE]") break;
      const chunk = JSON.parse(data) as {
        choices?: {
          delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] };
          finish_reason?: string | null;
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
        error?: { message?: string };
      };
      if (chunk.error) throw new ProviderHttpError(500, chunk.error.message ?? "Stream error");
      const choice = chunk.choices?.[0];
      if (choice?.delta?.content) out.push(choice.delta.content);
      // Tool calls arrive in pieces keyed by index: the id and name first, then argument fragments.
      for (const tc of choice?.delta?.tool_calls ?? []) {
        const k = tc.index ?? calls.length;
        calls[k] ??= { id: tc.id ?? `call_${round}_${k}`, type: "function", function: { name: "", arguments: "" } };
        if (tc.id) calls[k].id = tc.id;
        if (tc.function?.name) calls[k].function.name += tc.function.name;
        if (tc.function?.arguments) calls[k].function.arguments += tc.function.arguments;
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (chunk.usage) {
        usage.input += chunk.usage.prompt_tokens ?? 0;
        usage.output += chunk.usage.completion_tokens ?? 0;
      }
    }

    const pending = calls.filter(Boolean);
    if (!req.toolset || pending.length === 0 || finish === "length" || lastRound) {
      return { text: out.final(), stopReason: finish === "length" ? "max_tokens" : finish ? "end_turn" : null, usage };
    }
    messages.push({ role: "assistant", content: out.final().slice(before) || null, tool_calls: pending });
    for (const call of pending) {
      const input = parseArgs(call.function.arguments);
      const result = input === undefined ? toolArgsError(call.function.arguments) : await runTool(req.toolset, call.function.name, input, req.signal);
      out.push(toolMarker(req.toolset, call.function.name, input ?? {}, result));
      messages.push({ role: "tool", tool_call_id: call.id, content: textOnly(result) });
    }
  }
}

function functionTools(toolset?: Toolset) {
  return (toolset?.specs ?? []).map((s) => ({
    type: "function" as const,
    function: { name: s.name, description: s.description, parameters: s.inputSchema },
  }));
}

function parseArgs(raw: string): unknown {
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return undefined;
  }
}

function toolArgsError(raw: string): ToolOutput {
  return { text: `The tool arguments were not valid JSON: ${raw.slice(0, 200)}. Call the tool again with a JSON object.`, images: [], isError: true };
}

/** OpenAI-style tool messages carry text only. */
function textOnly(out: ToolOutput): string {
  const note = out.images.length ? `\n[${out.images.length} image(s) omitted: this provider only accepts text tool results]` : "";
  return (out.isError ? `Error: ${out.text}` : out.text || "(empty result)") + note;
}

/** Yields the payload of each `data:` event in a server-sent event stream. */
async function* sseData(res: Response): AsyncGenerator<string> {
  for await (const event of lines(res, /\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (data) yield data;
  }
}

// ------------------------------------------------------------ Ollama

type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { function: { name: string; arguments: unknown } }[];
  tool_name?: string;
};

async function streamOllama(target: ProviderTarget, req: TurnRequest): Promise<StreamResult> {
  const out = new VisibleText(req.onText);
  const usage = { input: 0, output: 0, cacheRead: 0 };
  const messages: OllamaMessage[] = [{ role: "system", content: req.system }, ...req.messages];
  let tools = functionTools(req.toolset);

  for (let round = 0; ; round++) {
    // Ollama has no tool_choice, so the last round simply drops the tools.
    const roundTools = round >= MAX_TOOL_ROUNDS ? [] : tools;
    const res = await fetch(joinUrl(target.baseUrl, "/api/chat"), {
      method: "POST",
      headers: { ...headers(target), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: target.model,
        stream: true,
        messages,
        ...(roundTools.length ? { tools: roundTools } : {}),
        options: { num_ctx: target.contextLength ?? DEFAULT_OLLAMA_CONTEXT },
      }),
      signal: req.signal,
    });
    if (!res.ok && roundTools.length) {
      const err = await httpError(res);
      if (!isToolsUnsupported(err.status, err.message)) throw err;
      tools = [];
      out.push(TOOLS_UNSUPPORTED_NOTE);
      round--;
      continue;
    }
    await assertOk(res);

    const before = out.final().length;
    const calls: { function: { name: string; arguments: unknown } }[] = [];
    let doneReason: string | null = null;
    // One JSON object per line.
    for await (const line of lines(res, /\r?\n/)) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line) as {
        message?: { content?: string; tool_calls?: { function: { name: string; arguments: unknown } }[] };
        done?: boolean;
        done_reason?: string;
        prompt_eval_count?: number;
        eval_count?: number;
        error?: string;
      };
      if (chunk.error) throw new ProviderHttpError(500, chunk.error);
      if (chunk.message?.content) out.push(chunk.message.content);
      if (chunk.message?.tool_calls) calls.push(...chunk.message.tool_calls);
      if (chunk.done) {
        doneReason = chunk.done_reason ?? "stop";
        usage.input += chunk.prompt_eval_count ?? 0;
        usage.output += chunk.eval_count ?? 0;
      }
    }

    if (!req.toolset || calls.length === 0 || doneReason === "length" || roundTools.length === 0) {
      return { text: out.final(), stopReason: doneReason === "length" ? "max_tokens" : doneReason ? "end_turn" : null, usage };
    }
    messages.push({ role: "assistant", content: out.final().slice(before), tool_calls: calls });
    for (const call of calls) {
      // Ollama sends arguments as an object; some models send a JSON string.
      const input = typeof call.function.arguments === "string" ? parseArgs(call.function.arguments) : call.function.arguments;
      const result =
        input === undefined ? toolArgsError(String(call.function.arguments)) : await runTool(req.toolset, call.function.name, input, req.signal);
      out.push(toolMarker(req.toolset, call.function.name, input ?? {}, result));
      messages.push({ role: "tool", tool_name: call.function.name, content: textOnly(result) });
    }
  }
}

// ------------------------------------------------------------ shared

/**
 * Reasoning models (DeepSeek R1, Qwen 3 and others) put their reasoning in
 * <think> tags inside the reply. It is hidden from the chat and from the
 * action parser, which only sees the visible text.
 */
class VisibleText {
  private raw = "";
  private emitted = 0;

  constructor(private readonly onText: (delta: string) => void) {}

  push(delta: string): void {
    this.raw += delta;
    const visible = stripThinking(this.raw, true);
    if (visible.length > this.emitted) {
      this.onText(visible.slice(this.emitted));
      this.emitted = visible.length;
    }
  }

  final(): string {
    return stripThinking(this.raw, false);
  }
}

/** Removes <think> blocks. While streaming, an unclosed block or a partial tag is held back. */
export function stripThinking(text: string, streaming: boolean): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
  const open = out.indexOf("<think>");
  if (open >= 0) out = out.slice(0, open);
  if (streaming) {
    const lt = out.lastIndexOf("<");
    if (lt >= 0 && "<think>".startsWith(out.slice(lt))) out = out.slice(0, lt);
  }
  return out;
}

async function* lines(res: Response, separator: RegExp): AsyncGenerator<string> {
  if (!res.body) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    const parts = buffer.split(separator);
    buffer = parts.pop() ?? "";
    yield* parts;
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield buffer;
}

function headers(target: ProviderTarget): Record<string, string> {
  const h: Record<string, string> = {};
  if (target.apiKey) h.Authorization = `Bearer ${target.apiKey}`;
  // OpenRouter shows this in its activity log; other servers ignore it.
  if (target.preset.id === "openrouter") h["X-Title"] = "Atelier";
  return h;
}

async function getJson(url: string, target: ProviderTarget, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers: headers(target), signal: signal ?? AbortSignal.timeout(15_000) });
  await assertOk(res);
  return res.json();
}

async function assertOk(res: Response): Promise<void> {
  if (!res.ok) throw await httpError(res);
}

async function httpError(res: Response): Promise<ProviderHttpError> {
  let message = res.statusText;
  try {
    const body = (await res.json()) as { error?: { message?: string } | string; message?: string };
    message = (typeof body.error === "string" ? body.error : body.error?.message) ?? body.message ?? message;
  } catch {
    // Keep the status text.
  }
  return new ProviderHttpError(res.status, message);
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path;
}
