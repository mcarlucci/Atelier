# Importing a design system

[← Back to README](../README.md)

Atelier imports a design system from an npm package (public or private registry) or a local built package folder. The package is installed with `--ignore-scripts`, and its TypeScript declarations are read with the TypeScript compiler API:

- React: function, `forwardRef`/`memo`, class, and compound (`Dialog.Root`) components, with own props separated from inherited DOM attributes.
- Vue: anything constructing an instance with `$props`; `on*` props become events.
- Angular: `ɵcmp` metadata gives selectors, input aliases and required flags, outputs, standalone flags, and the NgModule to import.
- Entry points: the root and every subpath export are read. A subpath that points at JavaScript (Vuetify's `"./components": "./lib/components/index.js"`) is read from the `.d.ts` beside it. When those hold no components, wildcard subpaths (`./*`, `./components/*`) are expanded and default exports are named after their declaration or subpath. Components under `labs`, `experimental` or `unstable` paths are imported turned off.
- The framework comes from the package's dependencies. When none is listed (PrimeVue), each framework is tried. If nothing is found, the error lists the declaration files that were read.
- Global stylesheet (including a subpath such as `vuetify/styles` that resolves to CSS), provider (`Theme`, `*Provider`, `<Brand>Provider`), and CSS-variable tokens are detected. All of them can be edited.
- Known libraries get their setup: Vuetify 3+ gets `createVuetify()`, `vuetify/styles`, Material Design Icons and a `<VApp>` root; PrimeVue 4+ gets its plugin with the Aura theme; PrimeNG 18+ gets `providePrimeNG` with the Aura preset and the matching themes package; Angular Material 18+ gets the azure-blue prebuilt theme. `setup` in `atelier.manifest.json` overrides this.
- An optional `atelier.manifest.json` in the package root supplies guidelines, setup, examples, and enable/disable per component.

Next: [templates](templates.md) decide which starter app the components render in.
