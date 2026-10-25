# Security

[← Back to README](../README.md)

- Generated apps run as local Node processes with your user's permissions. Treat model output as untrusted code.
- Model-supplied paths are confined to the app folder. `.git`, `node_modules`, `.npmrc` and the generated setup file cannot be written. Package names are validated before `npm install`.
- API keys (one per provider) and registry tokens are encrypted with the OS keychain (`safeStorage`). A key is only sent to its own provider's base URL, and only over https or to a server on this computer. Registry tokens reach npm only through the `ATELIER_NPM_TOKEN` environment variable referenced from `.npmrc`; they are never written to disk or git.
- **Templates:** apps made from a custom template run its code and its packages' install scripts. Git imports use `--` before the URL, and only `https://` and `git@` URLs are accepted. Symlinks in a template are skipped when it is copied.
- **Connectors:**
  - A local MCP server runs its command with your user's permissions.
  - Connector tokens, environment values and OAuth tokens are encrypted like API keys. They are only sent over https, or to a server on this computer.
  - Tool results are treated as reference data, and the prompt tells the model not to follow instructions inside them. Anything the model does with them still goes through the same path confinement and design system check.
- **Element selection:** the selection script is injected by the main process only into the frame showing that app's dev server. Selections are accepted only from that frame and origin, are size-limited and sanitized, and reach the model as data, not instructions.
- The renderer is sandboxed with context isolation. IPC is an allowlist and rejects calls from subframes such as the preview iframe.
