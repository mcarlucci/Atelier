/**
 * Built-in sandbox templates. Each generates a small starter app for its
 * framework, choosing the framework major that the design system's peer
 * dependencies allow.
 */
import type { DesignSystem } from "@shared/types";
import type { TemplateInfo } from "@shared/templates";
import { angularKit, ANGULAR_STYLES_FILE } from "../frameworks/angular";
import { reactKit } from "../frameworks/react";
import { vueKit } from "../frameworks/vue";

export interface BuiltinTemplate {
  info: TemplateInfo;
  /** App files for the chosen framework major, without the setup files. */
  files(ds: DesignSystem, appName: string, major: number): Record<string, string>;
  /** Stack rules for the AI, before the setup rules. */
  rules(ds: DesignSystem): string;
  /** Node.js versions the toolchain for a framework major runs on (its CLI's `engines.node`). */
  node(major: number): string;
}

/** Vite 8's engines.node. */
const VITE_NODE = "^20.19.0 || >=22.12.0";

const GITIGNORE = "node_modules\ndist\n.angular\n*.log\n.DS_Store\n";
const AI_RULES = `# App notes

Add product context, naming, and constraints for this app here. They are sent with every request.
`;
const APP_CSS = `/* Layout only. Colors, type and spacing come from the design system. */
body {
  margin: 0;
}

.page {
  padding: 2rem;
}
`;

// ---------------------------------------------------------------- React + Vite

const react: BuiltinTemplate = {
  info: {
    id: "react-vite",
    name: "React + Vite",
    framework: "react",
    stack: "Vite",
    description: "React with TypeScript, Vite and react-router. Pages in src/pages.",
    source: { kind: "builtin" },
    devCommand: "npm run dev -- --port {port} --strictPort --host 127.0.0.1",
    setupFile: reactKit.defaultSetupPath,
    rules: "",
    versions: [19, 18],
    warnings: [],
  },
  node: () => VITE_NODE,
  rules: () => `# Stack
- React + TypeScript, bundled by Vite. Routing uses react-router-dom; keep all routes in src/App.tsx.
- Put pages in src/pages/ and reusable app components in src/components/. The default route renders src/pages/Index.tsx.
- When you add a component, also render it from a page, or the user cannot see it.
- Directory names are lower-case. Use the "@/..." alias or relative imports for project files.`,
  files: (ds, appName, major) => ({
    "package.json": json({
      name: slug(appName),
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
      dependencies: {
        react: `^${major}.0.0`,
        "react-dom": `^${major}.0.0`,
        "react-router-dom": "^7.0.0",
        [ds.packageName]: ds.dependencySpec,
        ...ds.setup.extraDependencies,
      },
      devDependencies: {
        "@types/react": `^${major}.0.0`,
        "@types/react-dom": `^${major}.0.0`,
        "@vitejs/plugin-react": "^6.0.0",
        typescript: "^5.9.0",
        vite: "^8.0.0",
      },
    }),
    "index.html": html(appName, '<div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>'),
    "vite.config.ts": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": "/src" } },
});
`,
    "tsconfig.json": json({
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        paths: { "@/*": ["./src/*"] },
      },
      include: ["src"],
    }),
    ".gitignore": GITIGNORE,
    "src/vite-env.d.ts": '/// <reference types="vite/client" />\n',
    "src/main.tsx": `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import DesignSystemRoot from "./design-system/DesignSystemRoot";
import App from "./App";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesignSystemRoot>
      <App />
    </DesignSystemRoot>
  </StrictMode>,
);
`,
    "src/App.tsx": `import { BrowserRouter, Route, Routes } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        {/* Add routes above the catch-all route. */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
`,
    "src/pages/Index.tsx": `export default function Index() {
  return (
    <main className="page">
      <h1>${escapeHtml(appName)}</h1>
      <p>Describe the screen you want in the chat, and it will be built from ${escapeHtml(ds.name)} components.</p>
    </main>
  );
}
`,
    "src/pages/NotFound.tsx": `import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <main className="page">
      <h1>Page not found</h1>
      <Link to="/">Back to home</Link>
    </main>
  );
}
`,
    "src/styles/app.css": APP_CSS,
    "AI_RULES.md": AI_RULES,
  }),
};

// ---------------------------------------------------------------- Vue + Vite

const vue: BuiltinTemplate = {
  info: {
    id: "vue-vite",
    name: "Vue + Vite",
    framework: "vue",
    stack: "Vite",
    description: "Vue 3 single-file components with TypeScript, Vite and vue-router. Pages in src/pages.",
    source: { kind: "builtin" },
    devCommand: "npm run dev -- --port {port} --strictPort --host 127.0.0.1",
    setupFile: vueKit.defaultSetupPath,
    rules: "",
    versions: [3],
    warnings: [],
  },
  node: () => VITE_NODE,
  rules: () => `# Stack
- Vue 3 single-file components with <script setup lang="ts">, bundled by Vite. Routing uses vue-router; keep all routes in src/router.ts.
- Put pages in src/pages/ (for example src/pages/IndexPage.vue) and reusable app components in src/components/. The "/" route renders src/pages/IndexPage.vue.
- When you add a component, also render it from a page, or the user cannot see it.
- Use the "@/..." alias or relative imports for project files.`,
  files: (ds, appName) => ({
    "package.json": json({
      name: slug(appName),
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
      dependencies: { vue: "^3.5.0", "vue-router": "^4.6.0", [ds.packageName]: ds.dependencySpec, ...ds.setup.extraDependencies },
      devDependencies: { "@vitejs/plugin-vue": "^6.0.0", typescript: "^5.9.0", vite: "^8.0.0" },
    }),
    "index.html": html(appName, '<div id="app"></div>\n    <script type="module" src="/src/main.ts"></script>'),
    "vite.config.ts": `import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { "@": "/src" } },
});
`,
    "tsconfig.json": json({
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "preserve",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        paths: { "@/*": ["./src/*"] },
      },
      include: ["src/**/*.ts", "src/**/*.vue"],
    }),
    ".gitignore": GITIGNORE,
    "src/env.d.ts": `/// <reference types="vite/client" />
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
`,
    "src/main.ts": `import { createApp, h } from "vue";
import { DesignSystemRoot, installDesignSystem } from "./design-system/setup";
import App from "./App.vue";
import router from "./router";
import "./styles/app.css";

const app = createApp({ render: () => h(DesignSystemRoot, null, { default: () => h(App) }) });
installDesignSystem(app);
app.use(router);
app.mount("#app");
`,
    "src/router.ts": `import { createRouter, createWebHistory } from "vue-router";
import IndexPage from "./pages/IndexPage.vue";
import NotFoundPage from "./pages/NotFoundPage.vue";

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: IndexPage },
    // Add routes above the catch-all route.
    { path: "/:pathMatch(.*)*", component: NotFoundPage },
  ],
});
`,
    "src/App.vue": `<template>
  <RouterView />
</template>
`,
    "src/pages/IndexPage.vue": `<template>
  <main class="page">
    <h1>${escapeHtml(appName)}</h1>
    <p>Describe the screen you want in the chat, and it will be built from ${escapeHtml(ds.name)} components.</p>
  </main>
</template>
`,
    "src/pages/NotFoundPage.vue": `<template>
  <main class="page">
    <h1>Page not found</h1>
    <RouterLink to="/">Back to home</RouterLink>
  </main>
</template>
`,
    "src/styles/app.css": APP_CSS,
    "AI_RULES.md": AI_RULES,
  }),
};

// ---------------------------------------------------------------- Angular CLI

/** TypeScript and zone.js ranges each Angular major accepts (its peer dependencies), and the Node.js its CLI needs. */
const ANGULAR_TOOLCHAIN: Record<number, { typescript: string; zone: string; node: string }> = {
  22: { typescript: "~6.0.0", zone: "~0.15.0", node: "^22.22.3 || ^24.15.0 || >=26.0.0" },
  21: { typescript: "~5.9.0", zone: "~0.15.0", node: "^20.19.0 || ^22.12.0 || >=24.0.0" },
  20: { typescript: "~5.9.0", zone: "~0.15.0", node: "^20.19.0 || ^22.12.0 || >=24.0.0" },
  19: { typescript: "~5.8.0", zone: "~0.15.0", node: "^18.19.1 || ^20.11.1 || >=22.0.0" },
  18: { typescript: "~5.5.0", zone: "~0.14.10", node: "^18.19.1 || ^20.11.1 || >=22.0.0" },
  17: { typescript: "~5.4.0", zone: "~0.14.0", node: "^18.13.0 || >=20.9.0" },
};

const angular: BuiltinTemplate = {
  info: {
    id: "angular-cli",
    name: "Angular CLI",
    framework: "angular",
    stack: "Angular CLI",
    description: "Standalone Angular components with the router, served by the Angular CLI. Pages in src/app/pages.",
    source: { kind: "builtin" },
    devCommand: "npx ng serve --port {port} --host 127.0.0.1",
    setupFile: angularKit.defaultSetupPath,
    rules: "",
    versions: Object.keys(ANGULAR_TOOLCHAIN).map(Number).sort((a, b) => b - a),
    warnings: [],
  },
  node: (major) => ANGULAR_TOOLCHAIN[major]?.node ?? "*",
  rules: () => `# Stack
- Angular standalone components in TypeScript with the Angular router, served by the Angular CLI. Keep all routes in src/app/app.routes.ts.
- Put each page in src/app/pages/<name>/<name>-page.component.ts with an inline template. The "" route renders src/app/pages/index/index-page.component.ts.
- Put reusable app components in src/app/components/. When you add one, also use it from a page, or the user cannot see it.
- Use signals and the built-in control flow (@if, @for) in templates.`,
  files: (ds, appName, major) => {
    const tc = ANGULAR_TOOLCHAIN[major];
    const ng = `^${major}.0.0`;
    // Material and others need the animations provider before v20; later versions animate with CSS.
    const animations = major <= 19;
    const standalone = major < 19 ? "\n  standalone: true," : "";
    return {
      "package.json": json({
        name: slug(appName),
        private: true,
        version: "0.0.0",
        scripts: { start: "ng serve", build: "ng build" },
        dependencies: {
          ...(animations ? { "@angular/animations": ng } : {}),
          "@angular/common": ng,
          "@angular/compiler": ng,
          "@angular/core": ng,
          "@angular/forms": ng,
          "@angular/platform-browser": ng,
          "@angular/router": ng,
          rxjs: "~7.8.0",
          tslib: "^2.6.0",
          "zone.js": tc.zone,
          [ds.packageName]: ds.dependencySpec,
          ...ds.setup.extraDependencies,
        },
        devDependencies: {
          "@angular-devkit/build-angular": ng,
          "@angular/cli": ng,
          "@angular/compiler-cli": ng,
          typescript: tc.typescript,
        },
      }),
      "angular.json": json({
        $schema: "./node_modules/@angular/cli/lib/config/schema.json",
        version: 1,
        cli: { analytics: false },
        newProjectRoot: "projects",
        projects: {
          app: {
            projectType: "application",
            root: "",
            sourceRoot: "src",
            prefix: "app",
            architect: {
              build: {
                builder: "@angular-devkit/build-angular:application",
                options: {
                  outputPath: "dist/app",
                  index: "src/index.html",
                  browser: "src/main.ts",
                  polyfills: ["zone.js"],
                  tsConfig: "tsconfig.app.json",
                  assets: [],
                  styles: [ANGULAR_STYLES_FILE, "src/styles.css"],
                },
                configurations: { development: { optimization: false, extractLicenses: false, sourceMap: true } },
                defaultConfiguration: "development",
              },
              serve: {
                builder: "@angular-devkit/build-angular:dev-server",
                configurations: { development: { buildTarget: "app:build:development" } },
                defaultConfiguration: "development",
              },
            },
          },
        },
      }),
      "tsconfig.json": json({
        compileOnSave: false,
        compilerOptions: {
          outDir: "./dist/out-tsc",
          strict: true,
          noImplicitOverride: true,
          noPropertyAccessFromIndexSignature: true,
          noImplicitReturns: true,
          skipLibCheck: true,
          esModuleInterop: true,
          experimentalDecorators: true,
          moduleResolution: "bundler",
          importHelpers: true,
          target: "ES2022",
          module: "ES2022",
          useDefineForClassFields: false,
          lib: ["ES2022", "dom"],
        },
        angularCompilerOptions: { strictInjectionParameters: true, strictInputAccessModifiers: true, strictTemplates: true },
      }),
      "tsconfig.app.json": json({
        extends: "./tsconfig.json",
        compilerOptions: { outDir: "./out-tsc/app", types: [] },
        files: ["src/main.ts"],
        include: ["src/**/*.d.ts"],
      }),
      ".gitignore": GITIGNORE,
      "src/index.html": html(appName, "<app-root></app-root>"),
      "src/main.ts": `import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app/app.component";
import { appConfig } from "./app/app.config";

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
`,
      "src/app/app.config.ts": `import { type ApplicationConfig, provideZoneChangeDetection } from "@angular/core";
import { provideRouter } from "@angular/router";${animations ? '\nimport { provideAnimationsAsync } from "@angular/platform-browser/animations/async";' : ""}
import { routes } from "./app.routes";
import { designSystemProviders } from "./design-system";

export const appConfig: ApplicationConfig = {
  providers: [provideZoneChangeDetection({ eventCoalescing: true }), provideRouter(routes),${animations ? " provideAnimationsAsync()," : ""} ...designSystemProviders],
};
`,
      "src/app/app.component.ts": `import { Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";

@Component({
  selector: "app-root",${standalone}
  imports: [RouterOutlet],
  template: "<router-outlet />",
})
export class AppComponent {}
`,
      "src/app/app.routes.ts": `import type { Routes } from "@angular/router";
import { IndexPageComponent } from "./pages/index/index-page.component";
import { NotFoundPageComponent } from "./pages/not-found/not-found-page.component";

export const routes: Routes = [
  { path: "", component: IndexPageComponent },
  // Add routes above the catch-all route.
  { path: "**", component: NotFoundPageComponent },
];
`,
      "src/app/pages/index/index-page.component.ts": `import { Component } from "@angular/core";

@Component({
  selector: "app-index-page",${standalone}
  imports: [],
  template: \`
    <main class="page">
      <h1>${escapeHtml(appName)}</h1>
      <p>Describe the screen you want in the chat, and it will be built from ${escapeHtml(ds.name)} components.</p>
    </main>
  \`,
})
export class IndexPageComponent {}
`,
      "src/app/pages/not-found/not-found-page.component.ts": `import { Component } from "@angular/core";
import { RouterLink } from "@angular/router";

@Component({
  selector: "app-not-found-page",${standalone}
  imports: [RouterLink],
  template: \`
    <main class="page">
      <h1>Page not found</h1>
      <a routerLink="/">Back to home</a>
    </main>
  \`,
})
export class NotFoundPageComponent {}
`,
      "src/styles.css": APP_CSS,
      "AI_RULES.md": AI_RULES,
    };
  },
};

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [react, vue, angular];

// ---------------------------------------------------------------- helpers

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function html(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    ${body}
  </body>
</html>
`;
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"'`$\\{}]/g, (c) => `&#${c.charCodeAt(0)};`);
}
