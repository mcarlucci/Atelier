import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type {
  AppRecord,
  ChatRecord,
  DesignSystem,
  DesignSystemManifestOverride,
  DesignSystemSource,
  FrameworkId,
  MessageRecord,
  PreviewSaveResult,
  ProviderSettings,
  ProviderUpdate,
  RunnerStatus,
  Settings,
} from "@shared/types";
import { PROVIDERS, providerPreset, type ProviderId } from "@shared/providers";
import type { EventChannels } from "@shared/ipc";
import { applyFileActions, elideFileBodies, parseResponse, safeJoin } from "./chat/actions";
import { checkCompliance } from "./chat/compliance";
import { readAppNotes, snapshotCodebase } from "./chat/context";
import { DEFAULT_MODEL } from "./chat/llm";
import { describeProviderError, listModels, streamTurn, type ChatTurn, type ProviderTarget } from "./chat/providers";
import { BASE_PROMPT, connectorsPrompt } from "./chat/prompt";
import { importDesignSystem, npmEnv, npmrcFor } from "./design-system/importer";
import { buildDesignSystemRules } from "./design-system/rules";
import { writeFile } from "./templates";
import { TemplateService } from "./templates/service";
import { gitCommitAll, gitInit, gitLog, gitRestore, gitTrackedFiles } from "./git";
import { AppRunner, type RunTarget } from "./runner";
import { NodeRuntimes } from "./node/runtimes";
import type { FetchFn } from "./node/dist";
import { ConnectorService } from "./connectors/service";
import { sanitizeSelection, selectionPrompt } from "./preview/selection";
import { editsPrompt, planTextEdits, sanitizeEdits, writePlannedEdits } from "./preview/edits";
import { newId, Store } from "./store";

export interface SecretBox {
  encrypt(plain: string): string | Promise<string>;
  decrypt(cipher: string): string | Promise<string>;
}

export interface ServiceDeps {
  userDataDir: string;
  secrets: SecretBox;
  /** Opens an http(s) URL in the default browser (OAuth sign-in). */
  openExternal(url: string): void;
  emit<C extends keyof EventChannels>(channel: C, payload: EventChannels[C]): void;
  /** Downloads Node.js builds. Electron's net.fetch, which honours the system proxy. */
  fetch?: FetchFn;
  /** Node.js builds shipped with the app, if any. */
  bundledNodeDir?: string;
  /** nodejs.org/dist mirror for networks that block nodejs.org. */
  nodeMirror?: string;
  /** Screenshots a running dev server as a JPEG. Absent in tests. */
  capturePreview?(url: string): Promise<Buffer | null>;
}

/** Wait after a change before screenshotting, so HMR and restarts settle and bursts collapse into one capture. */
const PREVIEW_CAPTURE_DELAY_MS = 2500;

/** Design system records as stored, including the encrypted registry token. */
type StoredDesignSystem = DesignSystem & { encryptedAuthToken?: string };

export class Services {
  readonly store: Store;
  readonly runner: AppRunner;
  readonly connectors: ConnectorService;
  readonly templates: TemplateService;
  readonly node: NodeRuntimes;
  private inflight = new Map<string, AbortController>();
  private readonly previewsDir: string;
  private previewTimers = new Map<string, NodeJS.Timeout>();
  private capturing = new Set<string>();

  constructor(private readonly deps: ServiceDeps) {
    this.store = new Store(path.join(deps.userDataDir, "atelier.json"), {
      model: DEFAULT_MODEL,
      effort: "high",
      appsFolder: path.join(os.homedir(), "atelier-apps"),
    });
    this.previewsDir = path.join(deps.userDataDir, "previews");
    this.node = new NodeRuntimes({
      bundledDir: deps.bundledNodeDir,
      cacheDir: path.join(deps.userDataDir, "node"),
      fetchFn: deps.fetch ?? ((url) => fetch(url)),
      mirror: deps.nodeMirror,
    });
    this.templates = new TemplateService(this.store, path.join(deps.userDataDir, "templates"));
    this.connectors = new ConnectorService({
      store: this.store,
      secrets: deps.secrets,
      openExternal: deps.openExternal,
      onChange: (view) => deps.emit("connectors:status", view),
      designSystemExists: (id) => this.store.get().designSystems.some((d) => d.id === id),
      nodeRuntime: () => this.node.resolve([]),
    });
    this.runner = new AppRunner({
      onOutput: (o) => deps.emit("run:output", o),
      onStatus: (appId, status) => {
        deps.emit("run:status", { appId, status });
        if (status.state === "running") this.schedulePreview(appId);
      },
    });
  }

  // ------------------------------------------------------------ settings

  getSettings(): Settings {
    const s = this.store.get().settings;
    const providers = PROVIDERS.map((p) => this.providerSettings(p.id));
    const active = providers.find((p) => p.id === (s.provider ?? "anthropic"))!;
    return {
      provider: active.id,
      model: active.model,
      effort: s.effort,
      ready: Boolean(active.model) && (active.hasApiKey || !providerPreset(active.id).needsKey),
      appsFolder: s.appsFolder,
      providers,
      lastDesignSystemId: s.lastDesignSystemId,
      lastTemplateId: s.lastTemplateId,
    };
  }

  /** `model` applies to the active provider. */
  async setSettings(patch: Partial<Pick<Settings, "model" | "effort" | "appsFolder" | "lastDesignSystemId" | "lastTemplateId">>): Promise<Settings> {
    const { model, ...rest } = patch;
    if (model !== undefined) await this.configureProvider(this.getSettings().provider, { model });
    this.store.update((d) => Object.assign(d.settings, rest));
    return this.getSettings();
  }

  /**
   * Anthropic keeps its original fields (`model`, `encryptedApiKey`) so older
   * stores keep working; other providers live under `providerConfigs`.
   */
  async configureProvider(id: ProviderId, update: ProviderUpdate): Promise<Settings> {
    const preset = providerPreset(id);
    const current = this.providerSettings(id);
    const baseUrl = update.baseUrl === undefined ? undefined : validateBaseUrl(update.baseUrl, preset.kind === "anthropic");
    const keyAfter = update.apiKey === undefined ? current.hasApiKey : Boolean(update.apiKey?.trim());
    const urlAfter = baseUrl ?? current.baseUrl;
    if (keyAfter && urlAfter && !isSafeForKey(urlAfter)) {
      throw new Error("API keys are only sent over https, or over http to this computer. Use an https base URL.");
    }
    if (update.model !== undefined && update.model.length > 200) throw new Error("Model id is too long.");
    if (update.contextLength !== undefined && !(Number.isInteger(update.contextLength) && update.contextLength >= 2048 && update.contextLength <= 1_048_576)) {
      throw new Error("Context length must be a whole number between 2048 and 1048576.");
    }
    if (update.shownModels && (update.shownModels.length > 1000 || update.shownModels.some((m) => typeof m !== "string" || m.length > 200))) {
      throw new Error("Too many models, or a model id is too long.");
    }
    const encrypted = update.apiKey === undefined ? undefined : update.apiKey?.trim() ? await this.deps.secrets.encrypt(update.apiKey.trim()) : null;
    this.store.update((d) => {
      if (update.activate) d.settings.provider = id;
      // Kept with the other providers' configs, including Anthropic's.
      if (update.shownModels !== undefined) {
        const c = ((d.settings.providerConfigs ??= {})[id] ??= {});
        if (update.shownModels === null) delete c.shownModels;
        else c.shownModels = [...new Set(update.shownModels.map((m) => m.trim()).filter(Boolean))];
      }
      if (id === "anthropic") {
        if (update.model !== undefined) d.settings.model = update.model.trim();
        if (encrypted !== undefined) d.settings.encryptedApiKey = encrypted ?? undefined;
        return;
      }
      const configs = (d.settings.providerConfigs ??= {});
      const c = (configs[id] ??= {});
      if (baseUrl !== undefined) c.baseUrl = baseUrl;
      if (update.model !== undefined) c.model = update.model.trim();
      if (update.contextLength !== undefined) c.contextLength = update.contextLength;
      if (encrypted !== undefined) c.encryptedApiKey = encrypted ?? undefined;
    });
    return this.getSettings();
  }

  private providerSettings(id: ProviderId): ProviderSettings {
    const s = this.store.get().settings;
    const preset = providerPreset(id);
    if (id === "anthropic") {
      const shownModels = s.providerConfigs?.anthropic?.shownModels;
      return { id, baseUrl: "", hasApiKey: Boolean(s.encryptedApiKey || process.env.ANTHROPIC_API_KEY), model: s.model, ...(shownModels ? { shownModels } : {}) };
    }
    const c = s.providerConfigs?.[id] ?? {};
    return {
      id,
      baseUrl: c.baseUrl ?? preset.defaultBaseUrl,
      hasApiKey: Boolean(c.encryptedApiKey),
      model: c.model ?? "",
      ...(preset.kind === "ollama" ? { contextLength: c.contextLength } : {}),
      ...(c.shownModels ? { shownModels: c.shownModels } : {}),
    };
  }

  /** Everything needed to call a provider, including the decrypted key. Main process only. */
  private async providerTarget(id: ProviderId): Promise<ProviderTarget> {
    const s = this.store.get().settings;
    const preset = providerPreset(id);
    const ps = this.providerSettings(id);
    const enc = id === "anthropic" ? s.encryptedApiKey : s.providerConfigs?.[id]?.encryptedApiKey;
    const apiKey = enc ? await this.deps.secrets.decrypt(enc) : id === "anthropic" ? process.env.ANTHROPIC_API_KEY : undefined;
    if (preset.needsKey && !apiKey) throw new Error(`Add a ${preset.label} API key in Settings first.`);
    return { preset, baseUrl: ps.baseUrl, apiKey, model: ps.model, effort: s.effort, contextLength: ps.contextLength };
  }

  async listProviderModels(id: ProviderId): Promise<{ models: string[]; error?: string }> {
    try {
      const target = await this.providerTarget(id);
      try {
        return { models: await listModels(target) };
      } catch (err) {
        return { models: [], error: describeProviderError(err, target) };
      }
    } catch (err) {
      return { models: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ------------------------------------------------------------ design systems

  listDesignSystems(): DesignSystem[] {
    return this.store.get().designSystems.map(publicDs);
  }

  getDesignSystem(id: string): DesignSystem {
    return publicDs(this.storedDs(id));
  }

  private storedDs(id: string): StoredDesignSystem {
    const ds = this.store.get().designSystems.find((d) => d.id === id);
    if (!ds) throw new Error("Design system not found");
    return ds as StoredDesignSystem;
  }

  async importDesignSystem(input: {
    source: DesignSystemSource;
    authToken?: string;
    framework?: FrameworkId;
    override?: DesignSystemManifestOverride;
  }): Promise<DesignSystem> {
    const id = newId();
    const ds = await importDesignSystem({
      id,
      source: input.source,
      authToken: input.authToken,
      framework: input.framework,
      override: input.override,
      workDir: path.join(this.deps.userDataDir, "design-systems", id),
      node: await this.node.resolve([]),
      onLog: (line) => this.deps.emit("ds:import-progress", { line }),
    });
    const stored: StoredDesignSystem = {
      ...ds,
      encryptedAuthToken: input.authToken ? await this.deps.secrets.encrypt(input.authToken) : undefined,
    };
    this.store.update((d) => d.designSystems.push(stored));
    return publicDs(stored);
  }

  /** Re-reads the package (for example after a new release) and keeps team-authored edits. */
  async reimportDesignSystem(id: string): Promise<DesignSystem> {
    const current = this.storedDs(id);
    const token = current.encryptedAuthToken ? await this.deps.secrets.decrypt(current.encryptedAuthToken) : undefined;
    const fresh = await importDesignSystem({
      id,
      source: current.source,
      authToken: token,
      framework: current.framework,
      override: {
        name: current.name,
        guidelines: current.guidelines,
        setup: current.setup,
        components: Object.fromEntries(
          current.components.map((c) => [c.name, { description: c.description, examples: c.examples, enabled: c.enabled }]),
        ),
      },
      workDir: path.join(this.deps.userDataDir, "design-systems", id),
      node: await this.node.resolve([]),
      onLog: (line) => this.deps.emit("ds:import-progress", { line }),
    });
    return this.replaceDs({ ...fresh, defaultTemplateId: current.defaultTemplateId, encryptedAuthToken: current.encryptedAuthToken });
  }

  updateDesignSystem(
    id: string,
    patch: Partial<Pick<DesignSystem, "name" | "guidelines" | "tokens" | "setup" | "components" | "defaultTemplateId">>,
  ): DesignSystem {
    const current = this.storedDs(id);
    if (patch.defaultTemplateId) this.templates.choose(publicDs(current), patch.defaultTemplateId);
    const updated = this.replaceDs({ ...this.storedDs(id), ...patch });
    if (patch.setup) this.refreshManagedFiles(updated);
    return updated;
  }

  deleteDesignSystem(id: string): void {
    if (this.store.get().apps.some((a) => a.designSystemId === id)) {
      throw new Error("Delete the apps that use this design system first.");
    }
    this.store.update((d) => {
      d.designSystems = d.designSystems.filter((x) => x.id !== id);
    });
    fs.rmSync(path.join(this.deps.userDataDir, "design-systems", id), { recursive: true, force: true });
  }

  /** The rules as the model sees them in an app made from the design system's default template. */
  previewRules(id: string): string {
    const ds = this.getDesignSystem(id);
    return buildDesignSystemRules(ds, this.templates.runtime(this.templates.choose(ds).id));
  }

  private replaceDs(ds: StoredDesignSystem): DesignSystem {
    this.store.update((d) => {
      d.designSystems = d.designSystems.map((x) => (x.id === ds.id ? ds : x));
    });
    return publicDs(ds);
  }

  /** Rewrites generated setup files in every app that uses the design system. */
  private refreshManagedFiles(ds: DesignSystem): void {
    for (const app of this.store.get().apps.filter((a) => a.designSystemId === ds.id)) {
      if (!fs.existsSync(app.path)) continue;
      let files: Record<string, string>;
      try {
        files = this.templates.forApp(app).setupFiles(ds);
      } catch {
        continue;
      }
      for (const [rel, content] of Object.entries(files)) writeFile(app.path, rel, content);
      void gitCommitAll(app.path, `Update ${ds.name} setup`).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------ apps

  listApps(): AppRecord[] {
    return [...this.store.get().apps].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private app(id: string): AppRecord {
    const app = this.store.get().apps.find((a) => a.id === id);
    if (!app) throw new Error("App not found");
    return app;
  }

  /** The returned record carries scaffold warnings (not stored), such as a framework version mismatch. */
  async createApp(input: { name: string; designSystemId: string; templateId?: string }): Promise<AppRecord> {
    const ds = this.storedDs(input.designSystemId);
    const template = this.templates.choose(publicDs(ds), input.templateId);
    const name = input.name.trim() || "Untitled app";
    const folder = uniqueFolder(this.store.get().settings.appsFolder, name);
    fs.mkdirSync(folder, { recursive: true });
    let warnings: string[] = [];
    try {
      // No nodeVersion: Atelier provides whichever Node.js the chosen framework version needs.
      warnings = this.templates.runtime(template.id).scaffold(folder, publicDs(ds), name);
      if (ds.source.kind === "npm" && ds.source.registry) {
        // Token is read from ATELIER_NPM_TOKEN at install time, never written here.
        fs.writeFileSync(path.join(folder, ".npmrc"), npmrcFor(ds.source.registry, Boolean(ds.encryptedAuthToken)));
      }
      await gitInit(folder);
      await gitCommitAll(folder, `Create ${name} with ${ds.name} (${template.name})`);
    } catch (err) {
      fs.rmSync(folder, { recursive: true, force: true });
      throw err;
    }
    const now = Date.now();
    const app: AppRecord = {
      id: newId(),
      name,
      path: folder,
      framework: ds.framework,
      designSystemId: ds.id,
      templateId: template.id,
      createdAt: now,
      updatedAt: now,
    };
    this.store.update((d) => d.apps.push(app));
    return warnings.length ? { ...app, warnings } : app;
  }

  renameApp(id: string, name: string): AppRecord {
    this.app(id);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("App name cannot be empty");
    this.store.update((d) => {
      const app = d.apps.find((a) => a.id === id)!;
      app.name = trimmed;
    });
    return this.app(id);
  }

  deleteApp(id: string): void {
    const app = this.app(id);
    this.runner.stop(id);
    const chatIds = new Set(this.store.get().chats.filter((c) => c.appId === id).map((c) => c.id));
    this.store.update((d) => {
      d.apps = d.apps.filter((a) => a.id !== id);
      d.chats = d.chats.filter((c) => c.appId !== id);
      d.messages = d.messages.filter((m) => !chatIds.has(m.chatId));
    });
    fs.rmSync(app.path, { recursive: true, force: true });
    clearTimeout(this.previewTimers.get(id));
    this.previewTimers.delete(id);
    fs.rmSync(this.previewFile(id), { force: true });
  }

  // ------------------------------------------------------------ preview images

  private previewFile(appId: string): string {
    return path.join(this.previewsDir, `${appId}.jpg`);
  }

  previewImage(id: string): string | null {
    try {
      return `data:image/jpeg;base64,${fs.readFileSync(this.previewFile(id)).toString("base64")}`;
    } catch {
      return null;
    }
  }

  /** Debounced: captures once the app's dev server is running and changes have settled. */
  private schedulePreview(appId: string): void {
    if (!this.deps.capturePreview) return;
    clearTimeout(this.previewTimers.get(appId));
    this.previewTimers.set(
      appId,
      setTimeout(() => {
        this.previewTimers.delete(appId);
        void this.capturePreview(appId);
      }, PREVIEW_CAPTURE_DELAY_MS),
    );
  }

  private async capturePreview(appId: string): Promise<void> {
    const status = this.runner.status(appId);
    if (status.state !== "running" || !this.deps.capturePreview) return;
    if (this.capturing.has(appId)) {
      this.schedulePreview(appId);
      return;
    }
    this.capturing.add(appId);
    try {
      const image = await this.deps.capturePreview(status.url);
      // The app may have been deleted while the page loaded.
      if (!image || !this.store.get().apps.some((a) => a.id === appId)) return;
      fs.mkdirSync(this.previewsDir, { recursive: true });
      fs.writeFileSync(this.previewFile(appId), image);
      this.deps.emit("app:preview-image", { appId });
    } finally {
      this.capturing.delete(appId);
    }
  }

  async appFiles(id: string): Promise<string[]> {
    return gitTrackedFiles(this.app(id).path);
  }

  readAppFile(id: string, rel: string): string {
    const root = path.resolve(this.app(id).path);
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)) throw new Error("Invalid path");
    return fs.readFileSync(abs, "utf8");
  }

  managedFiles(id: string): string[] {
    const app = this.app(id);
    return Object.keys(this.templates.forApp(app).setupFiles(publicDs(this.storedDs(app.designSystemId))));
  }

  async writeAppFile(id: string, rel: string, content: string): Promise<void> {
    const app = this.app(id);
    const chatIds = new Set(this.listChats(id).map((c) => c.id));
    if ([...this.inflight.keys()].some((c) => chatIds.has(c))) throw new Error("Wait for the current reply to finish, then save.");
    const normalized = rel.replace(/\\/g, "/").replace(/^\.\//, "");
    if (this.managedFiles(id).includes(normalized)) throw new Error(`${normalized} is generated from the design system setup. Change the setup under Design systems instead.`);
    const abs = safeJoin(app.path, normalized);
    if (!fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) throw new Error(`${normalized} no longer exists.`);
    fs.writeFileSync(abs, content);
    if (await gitCommitAll(app.path, `Edit ${normalized}`)) {
      this.touch(id);
      this.schedulePreview(id);
    }
  }

  /**
   * One save of preview edits makes one version: text edits that map to one
   * place each are written and committed here; otherwise nothing is written and
   * the caller sends the returned prompt as a chat turn, which commits.
   */
  async savePreviewEdits(id: string, raw: unknown): Promise<PreviewSaveResult> {
    const app = this.app(id);
    const edits = sanitizeEdits(raw, app.path);
    if (!edits.length) throw new Error("There are no edits to save.");
    const chatIds = new Set(this.listChats(id).map((c) => c.id));
    if ([...this.inflight.keys()].some((c) => chatIds.has(c))) throw new Error("Wait for the current reply to finish, then save.");
    const planned = edits.every((e) => e.kind === "text") ? planTextEdits(app.path, edits, await gitTrackedFiles(app.path), this.managedFiles(id)) : null;
    if (!planned?.size) return { committed: false, prompt: editsPrompt(edits) };
    const files = writePlannedEdits(app.path, planned);
    const count = edits.length === 1 ? "text" : `${edits.length} text edits`;
    await gitCommitAll(app.path, `Edit ${count} in the preview (${files.join(", ")})`);
    this.touch(id);
    this.schedulePreview(id);
    return { committed: true };
  }

  appPath(id: string): string {
    return this.app(id).path;
  }

  versions(id: string) {
    return gitLog(this.app(id).path);
  }

  async restoreVersion(id: string, hash: string): Promise<void> {
    await gitRestore(this.app(id).path, hash);
    this.touch(id);
    this.schedulePreview(id);
  }

  private touch(appId: string): void {
    this.store.update((d) => {
      const a = d.apps.find((x) => x.id === appId);
      if (a) a.updatedAt = Date.now();
    });
  }

  // ------------------------------------------------------------ run

  private async runTarget(appId: string): Promise<RunTarget> {
    const app = this.app(appId);
    const ds = this.storedDs(app.designSystemId);
    const token = ds.encryptedAuthToken ? await this.deps.secrets.decrypt(ds.encryptedAuthToken) : undefined;
    const template = this.templates.forApp(app);
    return {
      appId,
      dir: app.path,
      devCommand: template.devCommand,
      env: { ...npmEnv(token), ...template.kit.env },
      node: async (log) => {
        const rt = await this.node.resolve(template.nodeRanges(app.path), { preferred: app.nodeVersion, onLog: log });
        if (rt.source !== "system" && rt.version !== app.nodeVersion) {
          this.store.update((d) => {
            const a = d.apps.find((x) => x.id === appId);
            if (a) a.nodeVersion = rt.version;
          });
        }
        return rt;
      },
    };
  }

  async startApp(id: string): Promise<RunnerStatus> {
    return this.runner.start(await this.runTarget(id));
  }

  async restartApp(id: string, opts: { reinstall?: boolean } = {}): Promise<RunnerStatus> {
    return this.runner.restart(await this.runTarget(id), opts);
  }

  // ------------------------------------------------------------ chat

  listChats(appId: string): ChatRecord[] {
    return this.store.get().chats.filter((c) => c.appId === appId).sort((a, b) => b.createdAt - a.createdAt);
  }

  createChat(appId: string): ChatRecord {
    this.app(appId);
    const chat: ChatRecord = { id: newId(), appId, title: "New chat", createdAt: Date.now() };
    this.store.update((d) => d.chats.push(chat));
    return chat;
  }

  messages(chatId: string): MessageRecord[] {
    return this.store.get().messages.filter((m) => m.chatId === chatId);
  }

  cancel(chatId: string): void {
    this.inflight.get(chatId)?.abort();
  }

  /**
   * One build turn: stream the reply, apply its action tags, install packages,
   * check design system compliance, then commit.
   */
  async send(input: { chatId: string; prompt: string; selection?: unknown }): Promise<MessageRecord> {
    const chat = this.store.get().chats.find((c) => c.id === input.chatId);
    if (!chat) throw new Error("Chat not found");
    if (this.inflight.has(chat.id)) throw new Error("A reply is already in progress for this chat.");
    const app = this.app(chat.appId);
    const ds = this.getDesignSystem(app.designSystemId);
    const template = this.templates.forApp(app);
    const managedFiles = Object.keys(template.setupFiles(ds));
    const target = await this.providerTarget(this.getSettings().provider);

    const history = completedTurns(this.messages(chat.id));
    const selection = sanitizeSelection(input.selection, app.path);
    const userMsg: MessageRecord = { id: newId(), chatId: chat.id, role: "user", content: input.prompt, createdAt: Date.now(), ...(selection ? { selection } : {}) };
    const assistant: MessageRecord = { id: newId(), chatId: chat.id, role: "assistant", content: "", createdAt: Date.now() };
    this.store.update((d) => d.messages.push(userMsg));

    const controller = new AbortController();
    this.inflight.set(chat.id, controller);
    try {
      const snapshot = await snapshotCodebase(app.path);
      const notes = readAppNotes(app.path);
      const connectors = await this.connectors.toolsetFor(ds.id);
      if (connectors.warnings.length) assistant.warnings = connectors.warnings;
      const system = `${BASE_PROMPT}\n\n${buildDesignSystemRules(ds, template)}${connectors.toolset ? `\n\n${connectorsPrompt(connectors.connectors)}` : ""}`;
      const messages: ChatTurn[] = [
        ...history.map((m) => ({
          role: m.role,
          content:
            m.role === "assistant"
              ? elideFileBodies(m.content) || "(no reply)"
              : m.selection
                ? `${selectionPrompt(m.selection)}\n\n${m.content}`
                : m.content,
        })),
        {
          role: "user",
          content: `<codebase>\n${snapshot.text}\n</codebase>${notes ? `\n\n<app-notes>\n${notes}\n</app-notes>` : ""}\n\n${selection ? `${selectionPrompt(selection)}\n\n` : ""}${input.prompt}`,
        },
      ];

      const result = await streamTurn(target, {
        system,
        messages,
        toolset: connectors.toolset,
        signal: controller.signal,
        onText: (text) => {
          assistant.content += text;
          this.deps.emit("chat:chunk", { chatId: chat.id, messageId: assistant.id, text });
        },
      });
      assistant.content = result.text;

      if (result.stopReason === "refusal") {
        assistant.error = "The model declined this request. Rephrase it and try again.";
      } else {
        const parsed = parseResponse(result.text);
        const applied = applyFileActions(app.path, parsed.actions, managedFiles);
        if (applied.dependencies.length) {
          try {
            await this.runner.install(await this.runTarget(app.id), applied.dependencies);
          } catch (err) {
            applied.errors.push(err instanceof Error ? err.message : String(err));
          }
        }
        const changed = [...applied.written, ...applied.renamed.map((r) => r.to)];
        const compliance = checkCompliance(app.path, changed, ds, template.kit.sourceExtensions);
        const commitHash =
          (await gitCommitAll(app.path, parsed.summary ?? input.prompt.slice(0, 72)).catch((err: Error) => {
            applied.errors.push(`Commit failed: ${err.message}`);
            return null;
          })) ?? undefined;
        if (result.stopReason === "max_tokens") applied.errors.push("The reply hit the output limit; unfinished files were skipped.");
        assistant.actions = {
          written: applied.written,
          renamed: applied.renamed,
          deleted: applied.deleted,
          dependencies: applied.dependencies,
          commitHash,
          errors: applied.errors,
        };
        assistant.compliance = compliance;
        if (parsed.summary && chat.title === "New chat") {
          this.store.update((d) => {
            const c = d.chats.find((x) => x.id === chat.id);
            if (c) c.title = parsed.summary!.slice(0, 80);
          });
        }
        if (applied.dependencies.length || applied.commands.includes("restart") || applied.commands.includes("rebuild")) {
          void this.restartApp(app.id, { reinstall: applied.commands.includes("rebuild") });
        }
        this.touch(app.id);
        this.schedulePreview(app.id);
      }
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError || controller.signal.aborted) {
        assistant.error = "Cancelled. No changes were applied.";
      } else {
        assistant.error = describeProviderError(err, target);
      }
    } finally {
      this.inflight.delete(chat.id);
    }
    this.store.update((d) => d.messages.push(assistant));
    this.deps.emit("chat:done", { chatId: chat.id, message: assistant });
    return assistant;
  }
}

/** User/assistant pairs whose reply succeeded, so roles keep alternating. */
function completedTurns(all: MessageRecord[]): MessageRecord[] {
  const out: MessageRecord[] = [];
  for (let i = 0; i < all.length - 1; i++) {
    const [user, reply] = [all[i], all[i + 1]];
    if (user.role === "user" && reply.role === "assistant" && !reply.error) {
      out.push(user, reply);
      i++;
    }
  }
  return out;
}

function publicDs(ds: DesignSystem | StoredDesignSystem): DesignSystem {
  const { encryptedAuthToken: _omit, ...rest } = ds as StoredDesignSystem;
  return rest;
}

function uniqueFolder(root: string, name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
  let candidate = path.join(root, base);
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(root, `${base}-${i}`);
  return candidate;
}

function validateBaseUrl(raw: string, anthropic: boolean): string {
  const value = raw.trim();
  if (anthropic) {
    if (value) throw new Error("The Anthropic endpoint is not configurable.");
    return "";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a full base URL, such as http://localhost:11434.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The base URL must use http or https.");
  if (url.username || url.password) throw new Error("Put credentials in the API key field, not the URL.");
  return value.replace(/\/+$/, "");
}

/** Keys travel only over TLS, or to a server on this computer. */
function isSafeForKey(baseUrl: string): boolean {
  const url = new URL(baseUrl);
  return url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
