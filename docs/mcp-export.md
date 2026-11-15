# Use a design system in any chat client (MCP export)

[← Back to README](../README.md)

Each design system you add can be exported as a read-only [Model Context Protocol](https://modelcontextprotocol.io) server. The server serves the design system's compiled [Invariant UI](compliance.md) contract: components, props, tokens and approved patterns. Any MCP client, such as Claude Code or Cursor, can then look up components and validate code against your design system, outside Atelier.

## 1. Export the server from Atelier

1. Open **Settings > Design systems** and pick the design system.
2. Click **Export MCP server**. The button is disabled until the design system has a compiled contract. If it is disabled, open the **Compliance** tab and recompile.
3. In the save dialog, choose where to put the folder and click **Save**. The default name is `<name>-mcp`, for example `acme-ui-mcp`. Atelier creates that folder and never overwrites an existing one: pick a new name or move the old folder first.

The new folder contains:

- `invariant.contract.json`, `invariant.evidence.json` and `invariant.manifest.json` (when present), the compiled contract.
- `README.md`, with the client configuration shown below.

The folder contains data only. The MCP server itself is the `@invariant-ui/cli` package, which the client starts with `npx`.

Requirements: Node.js 20 or newer on the machine that runs the client, and network access the first time the client starts the server (npx downloads `@invariant-ui/cli@0.3.0`, the version Atelier bundles).

Keep the folder's absolute path. The client config refers to it, so if you move the folder, update the `--cwd` path in the config.

## 2. Connect your client

The configuration in the exported `README.md` looks like this, with your folder in place of `/path/to/acme-ui-mcp`:

```json
{
  "mcpServers": {
    "acme-ui": {
      "command": "npx",
      "args": ["-y", "@invariant-ui/cli@0.3.0", "mcp", "--cwd", "/path/to/acme-ui-mcp", "--dir", "."]
    }
  }
}
```

The server name (`acme-ui` here) is the slug of the design system name. You can rename it in your client.

### Claude Code

Add the server from the terminal. Use `--scope user` so it is available in every project and the config stays off the repository:

```bash
claude mcp add --transport stdio --scope user acme-ui -- npx -y @invariant-ui/cli@0.3.0 mcp --cwd "/path/to/acme-ui-mcp" --dir .
```

Quote the path if it contains spaces. Check that it connected:

```bash
claude mcp list
```

Inside a Claude Code session, run `/mcp` to see the server and its tools.

Alternatively, put the JSON above in a `.mcp.json` file at the root of one project. Use this only for a project that every team member can run from the same path, because the path is absolute. Claude Code asks you to approve project servers the first time they are used.

### Cursor

Cursor reads MCP servers from JSON files:

- For all projects: `~/.cursor/mcp.json`.
- For one project: `.cursor/mcp.json` in the project root.

Paste the JSON above into the file. If the file already has an `mcpServers` object, add the `acme-ui` entry inside it. Then open **Cursor Settings > Tools & MCP** and check that `acme-ui` is listed with a green indicator. If it is not, click it to see the error.

### Other clients

Any client that reads the standard `mcpServers` format accepts the JSON above unchanged. Claude Desktop reads it from `claude_desktop_config.json`, for example.

## 3. Check that it works

Start a new chat and ask:

> Use the acme-ui MCP server to give me an overview of the design system.

The client should call the `get_design_system_overview` tool. Then ask for a component by name, for example "Use acme-ui to show the props of Button", which calls `get_component`.

Tool names are prefixed by the server name in most clients. Claude Code, for example, shows `mcp__acme-ui__get_component`.

## Troubleshooting

- **`npx` not found:** install Node.js 20 or newer, then restart the client so it sees the new `PATH`.
- **Server fails to start with "No compiled contract":** the folder is missing `invariant.contract.json` or `invariant.evidence.json`. Export again from Atelier.
- **Server stops working after an update:** the design system was re-imported or recompiled after you exported. Export again and replace the folder.
- **Works in the terminal but not in the client:** the client may not share your shell's `PATH`. Use the full path to `npx` in the `command` field.

## What the server does not include

The server serves only the compiled Invariant UI contract, which is built from the design system's installed package. Settings you change in Atelier, such as disabled components, description overrides and guidelines, are not part of the export.
