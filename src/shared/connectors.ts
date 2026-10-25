/**
 * Connectors give the model read access to design-system knowledge and design
 * tools during a build turn: MCP servers (local commands or remote URLs) and a
 * built-in Figma REST connector. Their tools are offered to the model, which
 * decides when to call them.
 */

export type ConnectorKind = "mcp-stdio" | "mcp-http" | "figma-api";
export type ConnectorAuth = "none" | "bearer" | "oauth";

export interface ConnectorConfig {
  id: string;
  name: string;
  kind: ConnectorKind;
  enabled: boolean;
  /** Only offered to apps built with this design system; absent means every app. */
  designSystemId?: string;
  /** mcp-stdio */
  command?: string;
  args?: string[];
  /** Names of the environment variables passed to the command. Values are secret. */
  envNames?: string[];
  /** mcp-http */
  url?: string;
  auth: ConnectorAuth;
  /** A bearer token, Figma token or environment values are stored (encrypted, main process only). */
  hasSecret: boolean;
  /** Tools switched on or off by the user, overriding the default. */
  toolOverrides: Record<string, boolean>;
  presetId?: string;
}

export interface ConnectorTool {
  name: string;
  description: string;
  enabled: boolean;
  /** From the server's annotations; null when it doesn't say. */
  readOnly: boolean | null;
}

export type ConnectorState = "idle" | "connecting" | "needs-auth" | "connected" | "error";

export interface ConnectorView extends ConnectorConfig {
  state: ConnectorState;
  message?: string;
  tools: ConnectorTool[];
}

export interface ConnectorInput {
  id?: string;
  name: string;
  kind: ConnectorKind;
  enabled: boolean;
  designSystemId?: string;
  command?: string;
  args?: string[];
  url?: string;
  auth: ConnectorAuth;
  /** Bearer or Figma token. Omit to keep the stored one; null removes it. */
  secret?: string | null;
  /** Environment for mcp-stdio. Omit to keep; null removes. */
  env?: Record<string, string> | null;
  presetId?: string;
}

/**
 * Tools that say they change data are off until the user turns them on; tools
 * that are read-only, or don't say, are on.
 */
export function defaultToolEnabled(readOnly: boolean | null): boolean {
  return readOnly !== false;
}

export interface ConnectorPreset {
  id: string;
  label: string;
  blurb: string;
  /** Shown above the form: what to set up first. */
  setup?: string;
  setupUrl?: string;
  input: Omit<ConnectorInput, "enabled">;
}

export const CONNECTOR_PRESETS: readonly ConnectorPreset[] = [
  {
    id: "figma-desktop",
    label: "Figma desktop",
    blurb: "Figma's Dev Mode MCP server, running in the desktop app. Reads the selected frame or any Figma link.",
    setup: "In the Figma desktop app, open the main menu, then Preferences, and turn on the Dev Mode MCP server. Keep the app open while you build.",
    input: { name: "Figma desktop", kind: "mcp-http", url: "http://127.0.0.1:3845/mcp", auth: "none", presetId: "figma-desktop" },
  },
  {
    id: "figma-api",
    label: "Figma (API token)",
    blurb: "Reads designs, screenshots and component lists from Figma links with a personal access token. No desktop app needed.",
    setup: "In Figma, open Settings, then Security, and generate a personal access token with read access to file content.",
    input: { name: "Figma", kind: "figma-api", auth: "bearer", presetId: "figma-api" },
  },
  {
    id: "storybook",
    label: "Storybook",
    blurb: "Your design system's Storybook, through its MCP addon: component docs, stories and usage examples.",
    setup: "Add Storybook's MCP addon to your design system's Storybook and start it. Change the URL if Storybook runs elsewhere.",
    input: { name: "Storybook", kind: "mcp-http", url: "http://localhost:6006/mcp", auth: "none", presetId: "storybook" },
  },
  {
    id: "local",
    label: "Local MCP server",
    blurb: "Any MCP server started as a command on this computer, such as your design system's own docs server.",
    input: { name: "Design system docs", kind: "mcp-stdio", command: "npx", args: ["-y", "@your-org/design-system-mcp"], auth: "none", presetId: "local" },
  },
  {
    id: "remote",
    label: "Remote MCP server",
    blurb: "An MCP server at a URL (Streamable HTTP or SSE), with no auth, a bearer token, or OAuth sign-in.",
    input: { name: "Remote MCP server", kind: "mcp-http", url: "https://", auth: "oauth", presetId: "remote" },
  },
];
