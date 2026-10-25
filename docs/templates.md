# Templates and Node.js

[← Back to README](../README.md)

## Templates

A sandbox template is the starter app that design system components render in. A template targets one framework, and it can load any design system of that framework. On the home page, the design system and template pickers filter each other. Each design system has a default template, set under **Design systems → Templates**.

- **Built in:**
  - React + Vite (React 19 or 18).
  - Vue + Vite (Vue 3 with vue-router).
  - Angular CLI (Angular 17–22, standalone components).
- **Versions:** each new app gets the newest framework major that the design system's `peerDependencies` allow. Atelier provides the Node.js that version's toolchain needs (see [Node.js](#nodejs)). For example, Angular 22's CLI needs Node.js `^22.22.3 || ^24.15.0 || >=26`.
- **Custom templates:** import your own starter app, such as your product shell, from a local folder or a git repository (`https://` or `git@`). Atelier keeps a snapshot without `node_modules` or build output.
  - **Detected:** the framework, the stack (Vite, Next.js, Nuxt, Angular CLI, Create React App) and the dev command. `atelier.template.json` can override them, and adds notes for the AI.
  - **Angular wiring:** Atelier adds `src/design-system.css` to the build `styles` in `angular.json`, and `...designSystemProviders` to the root providers (an `ApplicationConfig`, or the bootstrapped NgModule), so Angular templates work without editing them first.
  - **Warnings:** Atelier warns when the template doesn't import its generated setup file and couldn't wire it in. The home page warns when a template's framework major doesn't fit the design system's peer range, and offers the built-in template instead.
  - **Installs:** a peer dependency conflict (`ERESOLVE`) is retried with `--legacy-peer-deps`, since Angular packages pin exact peer versions.
  - **Dev command:** `{port}` is replaced with the preview port, and leading `NAME=value` pairs become environment variables. No shell is used.

| Framework | Generated setup | The template wires it in by |
|---|---|---|
| React | `src/design-system/DesignSystemRoot.tsx` | wrapping the root in `<DesignSystemRoot>` |
| Vue | `src/design-system/setup.ts` | `installDesignSystem(app)` and rendering inside `<DesignSystemRoot>` |
| Angular | `src/app/design-system.ts`, `src/design-system.css` | `...designSystemProviders` in the app config; the CSS in `angular.json` styles |

## Node.js

Users don't need Node.js installed. Atelier installs and runs every app with its own Node.js:

- **Bundled:** packaged builds ship one LTS build in `Resources/node`. `npm run fetch-node` downloads it into `resources/node` before packaging, defaulting to the newest LTS for the current machine; pass `--platform`, `--arch` or `--range` to package for another target.
- **Downloaded:** when an app needs a version outside the bundled one, Atelier downloads the newest fitting LTS from nodejs.org once, checks it against the release's `SHASUMS256.txt`, and keeps it in `userData/node` for all apps. Downloads use Electron's network stack, so the system proxy applies. Set `ATELIER_NODE_MIRROR` to use a mirror of `https://nodejs.org/dist`.
- **Per app:** the range comes from the template's toolchain for the framework major in the app's `package.json`, plus `engines.node`, `.nvmrc` and `.node-version` when present. The version is pinned to the app record while it still fits.
- **Fallback:** if a download fails, a fitting Node.js on `PATH` is used.
- `npm` and `npx` run through the chosen `node`, which goes first on `PATH` for the dev server, package scripts and design system imports. Local MCP servers started with `node`, `npm` or `npx` use it too.
