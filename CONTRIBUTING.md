# Contributing to Atelier

## Develop

```bash
npm install
npm run dev          # Electron + Vite with hot reload
npm run build && npx electron .
npm test             # unit tests (extractor, action parser, compliance, rules)
ATELIER_INTEGRATION=1 npx vitest run tests/import.integration.test.ts      # imports @radix-ui/themes from npm
ATELIER_INTEGRATION=1 npx vitest run tests/templates.integration.test.ts   # installs, builds and serves each built-in template
```

To package installers locally, run `npm run fetch-node` and `npm run fetch-git` for each target (`-- --platform <darwin|win32|linux> --arch <x64|arm64>`), then `npm run dist`. Output goes to `dist/`.

Requirements: Node 22.18+ and npm for developing Atelier itself. Run `npm run fetch-node` and `npm run fetch-git` once, so apps use the bundled Node.js and git in development too. Without the bundled git, development runs fall back to git on `PATH`.

## Release

Releases are made by [release-please](https://github.com/googleapis/release-please) from [Conventional Commit](https://www.conventionalcommits.org) messages on `main`:

- `fix:` makes a patch release. `feat:` makes a minor release. `feat!:` or a `BREAKING CHANGE:` footer makes a major release; before 1.0.0, it makes a minor release instead.
- Other types (`chore:`, `docs:`, `refactor:`, `test:`) don't make a release on their own.
- On every push to `main`, the **Release** workflow (`.github/workflows/release.yml`) opens or updates a release PR with the version bump and `CHANGELOG.md`. Merging that PR tags the version, publishes the GitHub release, and attaches the macOS, Windows and Linux installers a few minutes later.
- With squash merges, the PR title becomes the commit message, so it must follow the convention.

## UI

Atelier's own interface is built on [Slab](https://slab-elements.dev) (`slab-elements`), a headless Web Component library. Slab supplies behavior (keyboard, focus, ARIA, forms) and Atelier supplies the look:

- `src/renderer/src/ui/slab.tsx`: typed React wrappers. Properties are set and events attached through refs, as Slab recommends for React.
- `src/renderer/src/ui/theme.css`: all visuals, through `::part()` and `:state()`.
- Slab has no button element, so native `<button>` is styled in `styles.css`.
- `src/renderer/src/styles.css` holds light and dark tokens. The Appearance setting (light, dark, system) sets `data-theme` on `<html>`.
- Icons are inline SVGs in `src/renderer/src/ui/icons.tsx`. Chat replies render through a small Markdown renderer that builds React elements, never HTML strings.
- The chat composer (`components/PromptBox.tsx`) is a native `<textarea>`, because growing with its content needs `scrollHeight`, which Slab's shadow root hides.

## Layout

```
src/main/design-system/   importer (npm install, entry points, CSS/tokens/provider), extract (TS compiler API), rules (prompt)
src/main/frameworks/      per-framework kits: component usage, generated setup files, compliance extensions
src/main/templates/       built-in templates, custom template import/detection, runtime (scaffold, rules, dev command)
src/main/chat/            prompt, codebase snapshot, model providers (Claude SDK, Ollama, OpenAI-compatible) with tool loops, action-tag parser/applier, compliance check
src/main/preview/         element selection tool (injected script) and selection prompt
src/main/connectors/      MCP client manager (stdio, HTTP, OAuth), Figma REST tools, connector settings
src/main/node/            Node.js runtimes for apps: bundled and downloaded builds, version choice per app
src/main/                 services (orchestration), runner (dev servers), git, store, Electron entry
src/preload/              allowlisted contextBridge API
src/renderer/             React UI: Apps, Design systems, Workspace, Settings
```
