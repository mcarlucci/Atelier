# Connectors

[← Back to README](../README.md)

**Connectors** (in the left bar) give the model read access to design-system knowledge and design tools during a build turn. The model decides when to call their tools, and each call shows in the chat.

- **MCP servers:** local servers started as a command (stdio), or remote servers at a URL (Streamable HTTP, falling back to SSE). Remote servers can use no auth, a bearer token, or OAuth sign-in. Sign-in uses dynamic client registration and PKCE, through the browser and a loopback redirect on `127.0.0.1:33418`.
- **Presets:**
  - Figma desktop: the Dev Mode MCP server at `http://127.0.0.1:3845/mcp`.
  - Storybook: its MCP addon at `http://localhost:6006/mcp`.
  - Local MCP server and Remote MCP server.
- **Figma (API token):** a built-in connector that uses the REST API with a personal access token. Its tools are `get_design` (a simplified layer tree with layout, text, colors and component instances), `get_screenshot` (a PNG render) and `list_components`.
- **Scope:** a connector can apply to every app, or only to apps built with one design system.
- **Tool defaults:** tools that a server marks as changing data (`readOnlyHint: false`) are off until you turn them on. Each tool can be switched on or off.
- **Providers:** tool calls work with every provider. Images from tools reach Claude only; OpenAI-compatible and Ollama tool results carry text. If a model rejects tools, the turn runs without them and says so.
