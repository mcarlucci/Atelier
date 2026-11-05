/**
 * Gives the model Invariant UI's read-only MCP tools (components, tokens,
 * approved patterns, usage validation) for one app during one turn. Atelier's
 * connectors are global settings, but Invariant serves each app's own
 * contract, so this opens a server per turn instead of storing a connector.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { toOutput } from "../connectors/manager";
import { normalizeSchema, toolName } from "../connectors/service";
import type { ToolSpec, Toolset } from "../chat/tools";

const NAME = "Invariant UI";
const CONNECT_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 60_000;

export interface InvariantToolset {
  toolset: Toolset;
  close(): Promise<void>;
}

export async function openInvariantToolset(command: { command: string; args: string[]; env: Record<string, string> }): Promise<InvariantToolset | undefined> {
  const client = new Client({ name: "atelier", version: "1" });
  try {
    await client.connect(new StdioClientTransport({ ...command, stderr: "ignore" }), { timeout: CONNECT_TIMEOUT_MS });
    const listed = await client.listTools(undefined, { timeout: CONNECT_TIMEOUT_MS });
    const routes = new Map<string, string>();
    const specs: ToolSpec[] = [];
    for (const t of listed.tools) {
      if (t.annotations?.readOnlyHint === false) continue;
      const name = toolName(NAME, t.name);
      routes.set(name, t.name);
      specs.push({
        name,
        description: `[${NAME}] ${t.description ?? ""}`.slice(0, 1024),
        inputSchema: normalizeSchema(t.inputSchema as Record<string, unknown>),
        label: `${NAME} · ${t.name}`,
      });
    }
    if (specs.length === 0) {
      await client.close();
      return undefined;
    }
    specs.sort((a, b) => a.name.localeCompare(b.name));
    return {
      toolset: {
        specs,
        call: async (name, input, signal) => {
          const tool = routes.get(name);
          if (!tool) throw new Error(`Unknown tool: ${name}`);
          const result = await client.callTool({ name: tool, arguments: (input ?? {}) as Record<string, unknown> }, undefined, { signal, timeout: CALL_TIMEOUT_MS });
          return toOutput(result as Parameters<typeof toOutput>[0]);
        },
      },
      close: () => client.close().catch(() => {}),
    };
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }
}

/** One toolset from several; later toolsets can't shadow earlier tool names. */
export function mergeToolsets(...sets: (Toolset | undefined)[]): Toolset | undefined {
  const live = sets.filter((s): s is Toolset => Boolean(s));
  if (live.length === 0) return undefined;
  if (live.length === 1) return live[0];
  const owner = new Map<string, Toolset>();
  const specs: ToolSpec[] = [];
  for (const set of live) {
    for (const spec of set.specs) {
      if (owner.has(spec.name)) continue;
      owner.set(spec.name, set);
      specs.push(spec);
    }
  }
  return {
    specs,
    call: (name, input, signal) => {
      const set = owner.get(name);
      if (!set) throw new Error(`Unknown tool: ${name}`);
      return set.call(name, input, signal);
    },
  };
}
