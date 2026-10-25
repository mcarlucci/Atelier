/**
 * Provider-neutral tool plumbing for a build turn. Connectors supply tools;
 * each provider adapter (llm.ts, providers.ts) runs its own tool loop and
 * reports every call to the chat as an <atelier-tool> marker.
 */

export interface ToolSpec {
  /** Unique, provider-safe name: [A-Za-z0-9_-], at most 64 characters. */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Shown in the chat, e.g. "Figma · get_design". */
  label: string;
}

export interface ToolImage {
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  /** Base64. */
  data: string;
}

export interface ToolOutput {
  text: string;
  images: ToolImage[];
  isError: boolean;
}

export interface Toolset {
  specs: ToolSpec[];
  call(name: string, input: unknown, signal: AbortSignal): Promise<ToolOutput>;
}

/** Model round trips per turn before the model must answer without tools. */
export const MAX_TOOL_ROUNDS = 12;
export const MAX_TOOL_TEXT = 60_000;

export function toolError(message: string): ToolOutput {
  return { text: message, images: [], isError: true };
}

/** Keeps a result inside the context budget, saying so when it cuts. */
export function clampText(text: string): string {
  if (text.length <= MAX_TOOL_TEXT) return text;
  return `${text.slice(0, MAX_TOOL_TEXT)}\n[truncated: ${text.length - MAX_TOOL_TEXT} more characters. Ask for a narrower part if you need it.]`;
}

/** Runs one call, turning thrown errors into error results the model can read. */
export async function runTool(toolset: Toolset, name: string, input: unknown, signal: AbortSignal): Promise<ToolOutput> {
  if (!toolset.specs.some((s) => s.name === name)) return toolError(`Unknown tool: ${name}`);
  try {
    const out = await toolset.call(name, input, signal);
    return { ...out, text: clampText(out.text) };
  } catch (err) {
    if (signal.aborted) throw err;
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

/** The chat-visible record of a call. The action parser ignores it. */
export function toolMarker(toolset: Toolset, name: string, input: unknown, out: ToolOutput): string {
  const label = toolset.specs.find((s) => s.name === name)?.label ?? name;
  const summary = out.isError ? out.text.split("\n")[0].slice(0, 200) : summarizeInput(input);
  return `\n<atelier-tool name="${clean(label)}" status="${out.isError ? "error" : "ok"}">${clean(summary)}</atelier-tool>\n`;
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const values = Object.values(input as Record<string, unknown>).filter((v) => typeof v === "string" || typeof v === "number");
  return values.map(String).join(" · ").slice(0, 160);
}

function clean(s: string): string {
  return s.replace(/[<>"]/g, (c) => ({ "<": "‹", ">": "›", '"': "'" })[c]!);
}

/** Note shown when a model rejects tools, so the user knows why connectors were skipped. */
export const TOOLS_UNSUPPORTED_NOTE = "\n_(This model doesn't support tool calls, so connectors weren't used this turn.)_\n";

/** True for errors a server returns when the model cannot take `tools`. */
export function isToolsUnsupported(status: number, message: string): boolean {
  return [400, 404, 422].includes(status) && /tool|function/i.test(message);
}
