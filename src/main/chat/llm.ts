import Anthropic from "@anthropic-ai/sdk";
import type { EffortLevel } from "@shared/types";
import { MAX_TOOL_ROUNDS, runTool, toolMarker, type ToolOutput, type Toolset } from "./tools";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
] as const;

export const DEFAULT_MODEL = "claude-opus-5-5";

export interface StreamRequest {
  apiKey: string;
  model: string;
  effort: EffortLevel;
  /** Stable, cacheable prefix: base prompt and design system rules. */
  system: string;
  messages: Anthropic.Beta.Messages.BetaMessageParam[];
  signal: AbortSignal;
  onText(delta: string): void;
  /** Connector tools the model may call. */
  toolset?: Toolset;
}

export interface StreamResult {
  text: string;
  stopReason: string | null;
  usage: { input: number; output: number; cacheRead: number };
}

/**
 * Streams one build turn. The system block carries a cache breakpoint so the
 * design system catalog, usually the largest part of the prompt, is reused
 * across turns; the tool list renders before it, so it is cached too (it is
 * sorted for that reason). With tools, this is a manual streaming loop: run
 * the requested tools, send the results, and continue until the model answers.
 */
export async function streamBuildTurn(req: StreamRequest): Promise<StreamResult> {
  const client = new Anthropic({ apiKey: req.apiKey });
  // Server-side refusal fallback is available for Opus and Sonnet, not Haiku.
  const fallback = req.model.startsWith("claude-haiku") ? {} : { fallbacks: "default" as const };
  // Tool inputs here are small (links, ids), so eager input streaming stays
  // off and the API validates them against each server's schema.
  const tools: Anthropic.Beta.Messages.BetaTool[] = (req.toolset?.specs ?? []).map((s) => ({
    name: s.name,
    description: s.description,
    input_schema: s.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
  }));
  const messages = [...req.messages];
  const usage = { input: 0, output: 0, cacheRead: 0 };
  let text = "";
  const emit = (delta: string) => {
    text += delta;
    req.onText(delta);
  };

  for (let round = 0; ; round++) {
    const lastRound = round >= MAX_TOOL_ROUNDS;
    const stream = client.beta.messages.stream(
      {
        model: req.model,
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        output_config: { effort: req.effort },
        betas: fallback.fallbacks ? ["server-side-fallback-2026-07-01"] : [],
        ...fallback,
        // After the round limit the tools stay declared (the history refers to
        // them) but the model has to answer.
        ...(tools.length ? { tools, tool_choice: { type: lastRound ? ("none" as const) : ("auto" as const) } } : {}),
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages,
      },
      { signal: req.signal },
    );
    stream.on("text", emit);
    const message = await stream.finalMessage();
    usage.input += message.usage.input_tokens;
    usage.output += message.usage.output_tokens;
    usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;

    const uses = message.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
    // Only a clean tool_use stop runs tools: a refusal or max_tokens stop can cut an input off mid-way.
    if (message.stop_reason !== "tool_use" || uses.length === 0 || !req.toolset || lastRound) {
      return { text, stopReason: message.stop_reason, usage };
    }

    // Thinking and tool_use blocks go back unchanged.
    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      const out = await runTool(req.toolset, use.name, use.input, req.signal);
      emit(toolMarker(req.toolset, use.name, use.input, out));
      results.push({ type: "tool_result", tool_use_id: use.id, is_error: out.isError || undefined, content: resultContent(out) });
    }
    messages.push({ role: "user", content: results });
  }
}

function resultContent(out: ToolOutput): Anthropic.Beta.Messages.BetaToolResultBlockParam["content"] {
  return [
    { type: "text", text: out.text || "(empty result)" },
    ...out.images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.data } })),
  ];
}

export function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Update it in Settings.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key does not have access to the selected model.";
  if (err instanceof Anthropic.NotFoundError) return "The selected model was not found. Pick another model in Settings.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Wait a moment and try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API. Check your network or proxy.";
  if (err instanceof Anthropic.APIError) return `Anthropic API error (${err.status}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
