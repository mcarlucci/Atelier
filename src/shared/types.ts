import type { ProviderId } from "./providers";

export type FrameworkId = "react" | "vue" | "angular";

export interface PropInfo {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface ComponentInfo {
  /** Exported symbol name, e.g. `Button` or `ButtonComponent`. */
  name: string;
  /** Module specifier to import from, e.g. `@acme/ui`. */
  importPath: string;
  /** Imported as the module's default export (`import Button from "@acme/ui/button"`). */
  defaultExport?: boolean;
  /** Angular element selector, e.g. `acme-button`. */
  selector?: string;
  description?: string;
  props: PropInfo[];
  /** Angular outputs or Vue emits. */
  events?: string[];
  /** Native element the component wraps, when it extends a DOM attribute set. */
  extendsNative?: string;
  /** Angular: symbol to add to a standalone component's `imports` (the component or its NgModule). */
  angularImport?: string;
  /** Usage snippets supplied by the design system team. */
  examples?: string[];
  /** Excluded from prompts when false. */
  enabled: boolean;
}

export interface DesignSystemSetup {
  /** Stylesheets imported once at app entry, e.g. `@acme/ui/styles.css`. */
  globalCss: string[];
  /** Optional provider wrapping the app root. */
  provider?: { importName: string; importPath: string; props?: string };
  /** Extra packages the design system needs at runtime (peer deps, fonts). */
  extraDependencies: Record<string, string>;
  /** Angular only: NgModule or standalone imports needed in the root. */
  angularModules?: { importName: string; importPath: string }[];
  /**
   * Angular only: provider calls added to the root providers, such as
   * `providePrimeNG({ theme: { preset: Aura } })`. An import name may be
   * `default as Aura` for a default export.
   */
  angularProviders?: { expression: string; imports: { importName: string; importPath: string }[] }[];
  /**
   * Vue only: a plugin installed with app.use(). With `factory`, it is called
   * first, as in `app.use(createVuetify(options))`.
   */
  vuePlugin?: {
    importName: string;
    importPath: string;
    options?: string;
    factory?: boolean;
    /** Imports the options refer to, such as a theme preset. An import name may be `default as Aura`. */
    imports?: { importName: string; importPath: string }[];
  };
}

export type DesignSystemSource =
  | { kind: "npm"; spec: string; registry?: string }
  | { kind: "local"; path: string };

export interface DesignSystem {
  id: string;
  name: string;
  framework: FrameworkId;
  packageName: string;
  version: string;
  source: DesignSystemSource;
  /** Dependency spec written into generated apps' package.json. */
  dependencySpec: string;
  setup: DesignSystemSetup;
  components: ComponentInfo[];
  /** Free-form usage rules written by the design system team (markdown). */
  guidelines: string;
  /** Design tokens or CSS variables the model may use for custom layout. */
  tokens: string[];
  importedAt: number;
  warnings: string[];
  /** True when a private-registry token is stored (encrypted, main process only). */
  hasAuthToken: boolean;
  /** The package's peer dependencies, used to pick framework versions for new apps. */
  peerDependencies?: Record<string, string>;
  /** Template that new apps with this design system start from. */
  defaultTemplateId?: string;
}

export interface DesignSystemManifestOverride {
  name?: string;
  framework?: FrameworkId;
  guidelines?: string;
  tokens?: string[];
  setup?: Partial<DesignSystemSetup>;
  components?: Record<
    string,
    { description?: string; examples?: string[]; enabled?: boolean }
  >;
}

export interface AppRecord {
  id: string;
  name: string;
  path: string;
  framework: FrameworkId;
  designSystemId: string;
  /** Absent for apps created before templates existed: they use the framework's built-in template. */
  templateId?: string;
  createdAt: number;
  /** Node.js version the app last ran on. Kept while it satisfies the app's toolchain, so the app doesn't drift. */
  nodeVersion?: string;
  /** Returned by app:create only: problems found while scaffolding. */
  warnings?: string[];
  updatedAt: number;
}

export interface ChatRecord {
  id: string;
  appId: string;
  title: string;
  createdAt: number;
}

export interface ActionSummary {
  written: string[];
  renamed: { from: string; to: string }[];
  deleted: string[];
  dependencies: string[];
  commitHash?: string;
  errors: string[];
}

export interface ComplianceIssue {
  file: string;
  line: number;
  rule: "foreign-ui-library" | "native-element" | "unknown-ds-export";
  message: string;
}

/** An element picked in the preview with the selection tool. Comes from the app page, so it is untrusted. */
export interface SelectedElement {
  /** Path of the preview page, e.g. "/settings". */
  route: string;
  tag: string;
  id?: string;
  classes: string[];
  /** Visible text, trimmed. */
  text: string;
  /** Other attributes worth knowing (role, aria-label, href, type, name, placeholder...). */
  attributes: Record<string, string>;
  /** Trimmed outerHTML. */
  html: string;
  /** A few computed styles relevant to layout and typography. */
  styles: Record<string, string>;
  /** Owning components, innermost first, from the framework's dev tooling. */
  components: string[];
  /** Source file of the owning component when the framework reports it (Vue). Relative to the app. */
  file?: string;
  /** CSS-pixel box in the page. */
  rect: { x: number; y: number; width: number; height: number };
}

/** A sibling of a moved element, summarized for the prompt. */
export interface PreviewSibling {
  tag: string;
  classes: string[];
  text: string;
}

/**
 * A change the user made directly in the preview with the select tool. Read
 * from the page (model-written code), so it's sanitized like a selection.
 */
export type PreviewEdit =
  | { kind: "text"; element: SelectedElement; before: string; after: string }
  | {
      kind: "move";
      element: SelectedElement;
      parent: SelectedElement;
      from: number;
      to: number;
      /** The parent's children before and after the move, the moved one included. */
      orderBefore: PreviewSibling[];
      orderAfter: PreviewSibling[];
    };

/** Saving preview edits either commits them directly or hands a prompt to the chat. */
export type PreviewSaveResult = { committed: true } | { committed: false; prompt: string };

export interface MessageRecord {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  actions?: ActionSummary;
  compliance?: ComplianceIssue[];
  error?: string;
  /** Problems that didn't stop the turn, such as a connector that failed to connect. */
  warnings?: string[];
  /** User messages: the preview element the request is about. */
  selection?: SelectedElement;
}

export interface VersionInfo {
  hash: string;
  message: string;
  timestamp: number;
}

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface ProviderSettings {
  id: ProviderId;
  baseUrl: string;
  /** A key is stored (or, for Anthropic, set in the environment). Keys never reach the renderer. */
  hasApiKey: boolean;
  /** Last model chosen for this provider. */
  model: string;
  /** Ollama only: context window requested per turn, in tokens. */
  contextLength?: number;
  /**
   * Models offered in the prompt's model picker. Unset means every model the
   * active provider lists; other providers only appear once some are chosen.
   */
  shownModels?: string[];
}

export interface Settings {
  /** Active provider and its model. */
  provider: ProviderId;
  model: string;
  /** Anthropic only. */
  effort: EffortLevel;
  /** The active provider has the credentials it needs, and a model is chosen. */
  ready: boolean;
  appsFolder: string;
  providers: ProviderSettings[];
  /** Last design system and template picked on the home page. */
  lastDesignSystemId?: string;
  lastTemplateId?: string;
}

export interface ProviderUpdate {
  baseUrl?: string;
  model?: string;
  /** A new key, or null to remove the stored one. Omit to keep it. */
  apiKey?: string | null;
  contextLength?: number;
  /** Models offered in the prompt's model picker, or null to offer all again. */
  shownModels?: string[] | null;
  /** Make this the active provider. */
  activate?: boolean;
}

export type RunnerStatus =
  | { state: "stopped" }
  | { state: "installing" }
  | { state: "starting" }
  | { state: "running"; url: string }
  | { state: "error"; message: string };

export interface RunnerOutput {
  appId: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
}
