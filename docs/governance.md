# Governance with Invariant UI

[← Back to README](../README.md)

Atelier bundles [Invariant UI](https://invariantui.com), a tool that compiles a design system into a machine-readable **contract**: its components and props, tokens, and the UX patterns your team has approved. Atelier uses the contract in three places.

- **While the AI builds.** The model can read the contract through read-only tools (`Invariant_UI__get_component`, `get_design_patterns`, `validate_component_usage` and others). Each call shows in the chat. The system prompt tells it to follow approved patterns and to treat proposed or inferred ones as suggestions.
- **After each turn.** The files the turn wrote are validated against the contract. Findings join the design system check under the message, labeled "(Invariant UI)".
- **On the design system's Governance tab** (Settings > Design systems > pick one > Governance), which also holds the team's Guidelines and the AI rules preview:
  - **Contract:** component count, when it was compiled, any error, and a Recompile button.
  - **Browser checks:** whether Playwright and Chromium are installed, with an Install button.
  - **Guidelines:** the free-text usage rules sent with every request.
  - **AI rules preview:** exactly what the model receives about the design system.
- **On an app's Checks tab** in the workspace (next to Preview, Code and Versions):
  - **Code checks:** validate the whole `src` folder. Pattern rules are counted as pass, fail, warning, not verifiable and skipped. Not verifiable results are never counted as passes.
  - **Browser checks:** run Invariant's opt-in Playwright checks in a real Chromium against the running dev server. The app must be running. Every app gets a default spec with no setup: the page mounts content and shows no build error at phone, tablet and desktop widths, declares its language, and every image has alt text. To add your own scenarios, put an `invariant.browser.json` in the app's root (Invariant's browser spec format); it replaces the default. An app's own Playwright copy takes priority over Atelier's.
  - A link back to the design system's Governance tab.

## What happens on import

When you import a design system, Atelier compiles its contract right away, in the design system's own install folder, and shows the component count it found. New apps (and existing apps on that design system) receive that contract automatically, so the app's Checks tab works without any setup. Re-importing recompiles it. If the compile fails, the reason is stored with the design system and the app falls back to Atelier's own design system check. Apps no longer have a Compile button. An app that was compiled on its own earlier keeps its own contract; use Recompile on the design system for the shared one.

Atelier also installs Playwright and the Chromium browser in the background (about 150 MB, once, shared by every app), so browser checks work without touching the app's `package.json`. If that install fails or is skipped, the Governance tab has an Install button.

## What it reads

Atelier points Invariant at the design system package installed in the app (`node_modules/<package>`, with `declarations: true` in `invariant.config.json`) and reads its `.d.ts` files. Components are recognised by their declared types: `ForwardRefExoticComponent`, `FC`, `ComponentType`, functions that return `JSX.Element` or `ReactNode`, classes that extend `Component`, and compound objects such as `{ Root: typeof DialogRoot }`. If the package isn't installed yet, or no components are found, the tab says so and Atelier falls back to its own design system check.

Not covered yet: Vue and Angular declarations, `memo()` components declared as `MemoExoticComponent<…>`, and tokens.

The contract is compiled once per design system and copied into each app, together with an `invariant.config.json`. It lives in the app's `node_modules/.invariant` so the app's dev server doesn't reload the preview. A reinstall (`npm ci`) removes it; it comes back the next time the app is opened or the design system is recompiled.

## Notes

- **Local only.** Invariant uses no account, cloud or network. Recompiling unchanged sources gives identical output.
- **Bundled copy.** Atelier ships one copy of Invariant UI (about 44 MB, plain JavaScript) and runs it with Atelier's own Node.js. Invariant requires Node.js 24 or newer; Atelier's bundled Node.js qualifies.
- **License.** Invariant UI is source-available under FSL-1.1-ALv2 and becomes Apache-2.0 two years after each release. See `THIRD_PARTY_NOTICES.md`.
- **Developing Atelier.** Run `npm run fetch-invariant -- --from <path to invariant/dist-npm>` once to place it in `resources/invariant` (build it with `pnpm run build:npm` in the Invariant repo). Release builds do this in CI from a pinned commit of the Invariant repo, which must include declaration-file support (`declarations: true`).
