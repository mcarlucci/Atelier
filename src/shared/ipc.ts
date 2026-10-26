import type {
  AppRecord,
  ChatRecord,
  DesignSystem,
  DesignSystemManifestOverride,
  DesignSystemSource,
  EffortLevel,
  FrameworkId,
  MessageRecord,
  PreviewEdit,
  PreviewSaveResult,
  ProviderUpdate,
  RunnerOutput,
  RunnerStatus,
  SelectedElement,
  Settings,
  VersionInfo,
} from "./types";
import type { ProviderId } from "./providers";
import type { ConnectorInput, ConnectorView } from "./connectors";
import type { TemplateInfo, TemplateSource, TemplateUpdate } from "./templates";

/**
 * Request/response channels. The preload script exposes a single `invoke`
 * gated by this allowlist: one contextBridge API, with dynamic channel names
 * checked against a fixed list.
 */
/** `type` of the postMessage the preview's selection tool sends to the Atelier window. */
export const PREVIEW_SELECT_MESSAGE = "atelier:select";

export interface InvokeChannels {
  "settings:get": { args: []; result: Settings };
  "settings:set": {
    args: [Partial<{ model: string; effort: EffortLevel; appsFolder: string; lastDesignSystemId: string; lastTemplateId: string }>];
    result: Settings;
  };
  "settings:configure-provider": { args: [ProviderId, ProviderUpdate]; result: Settings };
  /** Whether an Anthropic key sits in the OS credential store. Never reads the key. */
  "settings:detect-keychain-key": { args: []; result: { found: boolean; source?: string } };
  /** Copies that key into Atelier's own encrypted store. */
  "settings:import-keychain-key": { args: []; result: Settings };
  /** Models the provider reports. Doubles as a connection test; `error` when the server can't be reached. */
  "llm:models": { args: [ProviderId]; result: { models: string[]; error?: string } };

  "ds:list": { args: []; result: DesignSystem[] };
  "ds:get": { args: [string]; result: DesignSystem };
  "ds:import": {
    args: [
      {
        source: DesignSystemSource;
        /** Private registry token. Encrypted at rest; never returned to the renderer. */
        authToken?: string;
        framework?: FrameworkId;
        override?: DesignSystemManifestOverride;
      },
    ];
    result: DesignSystem;
  };
  "ds:update": {
    args: [string, Partial<Pick<DesignSystem, "name" | "guidelines" | "tokens" | "setup" | "components" | "defaultTemplateId">>];
    result: DesignSystem;
  };
  "ds:reimport": { args: [string]; result: DesignSystem };
  "ds:delete": { args: [string]; result: void };
  "ds:preview-rules": { args: [string]; result: string };
  "ds:select-folder": { args: []; result: string | null };

  "app:list": { args: []; result: AppRecord[] };
  /** Without a templateId, the design system's default template is used. */
  "app:create": { args: [{ name: string; designSystemId: string; templateId?: string }]; result: AppRecord };
  "app:delete": { args: [string]; result: void };
  /** Renames the app in Atelier. Its folder keeps its name, so a running preview is unaffected. */
  "app:rename": { args: [string, string]; result: AppRecord };
  "app:files": { args: [string]; result: string[] };
  "app:read-file": { args: [string, string]; result: string };
  /** Saves an edit to an existing file and commits it, so it shows in Versions. */
  "app:write-file": { args: [string, string, string]; result: void };
  /** Files generated from the design system setup, which can't be edited. */
  "app:managed-files": { args: [string]; result: string[] };
  "app:reveal": { args: [string]; result: void };
  "app:versions": { args: [string]; result: VersionInfo[] };
  "app:restore-version": { args: [string, string]; result: void };
  /** Latest screenshot of the app's preview as a data URL, or null before the first capture. */
  "app:preview-image": { args: [string]; result: string | null };

  "chat:list": { args: [string]; result: ChatRecord[] };
  "chat:create": { args: [string]; result: ChatRecord };
  "chat:messages": { args: [string]; result: MessageRecord[] };
  "chat:send": { args: [{ chatId: string; prompt: string; selection?: SelectedElement }]; result: MessageRecord };
  "chat:cancel": { args: [string]; result: void };

  "templates:list": { args: []; result: TemplateInfo[] };
  "templates:import": { args: [Exclude<TemplateSource, { kind: "builtin" }>]; result: TemplateInfo };
  "templates:update": { args: [string, TemplateUpdate]; result: TemplateInfo };
  "templates:refresh": { args: [string]; result: TemplateInfo };
  "templates:delete": { args: [string]; result: void };
  "templates:files": { args: [string]; result: string[] };
  "templates:select-folder": { args: []; result: string | null };

  "connectors:list": { args: []; result: ConnectorView[] };
  "connectors:save": { args: [ConnectorInput]; result: ConnectorView };
  "connectors:delete": { args: [string]; result: void };
  /** Connects (signing in through the browser for OAuth) and lists tools. */
  "connectors:connect": { args: [string]; result: ConnectorView };
  "connectors:sign-out": { args: [string]; result: ConnectorView };
  "connectors:set-tool": { args: [string, string, boolean]; result: ConnectorView };

  /** Turns the element selection tool on or off in an app's preview frame. False when the preview isn't loaded. */
  "preview:select-mode": { args: [string, boolean]; result: boolean };
  /**
   * Saves text edits and moves made in the preview as one new version. Text
   * edits that map to exactly one place in the source are written and committed
   * here; anything else comes back as a prompt for a chat turn, which commits.
   */
  "preview:save-edits": { args: [string, PreviewEdit[]]; result: PreviewSaveResult };

  "run:start": { args: [string]; result: RunnerStatus };
  "run:stop": { args: [string]; result: void };
  "run:restart": { args: [string, { reinstall?: boolean }?]; result: RunnerStatus };
  "run:status": { args: [string]; result: RunnerStatus };
}

/** Main to renderer push events. */
export interface EventChannels {
  "chat:chunk": { chatId: string; messageId: string; text: string };
  "chat:done": { chatId: string; message: MessageRecord };
  "run:output": RunnerOutput;
  "run:status": { appId: string; status: RunnerStatus };
  "connectors:status": ConnectorView | { id: string; deleted: true };
  /** A new preview screenshot was saved for the app. */
  "app:preview-image": { appId: string };
  /** A step of a running design system import or re-import (install output, what is being read). */
  "ds:import-progress": { line: string };
}

export type InvokeChannel = keyof InvokeChannels;
export type EventChannel = keyof EventChannels;

export const INVOKE_CHANNELS: readonly InvokeChannel[] = [
  "settings:get",
  "settings:set",
  "settings:configure-provider",
  "settings:detect-keychain-key",
  "settings:import-keychain-key",
  "llm:models",
  "ds:list",
  "ds:get",
  "ds:import",
  "ds:update",
  "ds:reimport",
  "ds:delete",
  "ds:preview-rules",
  "ds:select-folder",
  "app:list",
  "app:create",
  "app:delete",
  "app:rename",
  "app:files",
  "app:read-file",
  "app:write-file",
  "app:managed-files",
  "app:reveal",
  "app:versions",
  "app:restore-version",
  "app:preview-image",
  "chat:list",
  "chat:create",
  "chat:messages",
  "chat:send",
  "chat:cancel",
  "templates:list",
  "templates:import",
  "templates:update",
  "templates:refresh",
  "templates:delete",
  "templates:files",
  "templates:select-folder",
  "connectors:list",
  "connectors:save",
  "connectors:delete",
  "connectors:connect",
  "connectors:sign-out",
  "connectors:set-tool",
  "preview:select-mode",
  "preview:save-edits",
  "run:start",
  "run:stop",
  "run:restart",
  "run:status",
];

export const EVENT_CHANNELS: readonly EventChannel[] = [
  "chat:chunk",
  "chat:done",
  "run:output",
  "run:status",
  "connectors:status",
  "app:preview-image",
  "ds:import-progress",
];

export interface AtelierApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeChannels[C]["args"]
  ): Promise<InvokeChannels[C]["result"]>;
  on<C extends EventChannel>(channel: C, listener: (payload: EventChannels[C]) => void): () => void;
}
