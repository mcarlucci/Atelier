import path from "node:path";
import { execFileSync } from "node:child_process";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, safeStorage, shell } from "electron";
import { INVOKE_CHANNELS, type EventChannels, type InvokeChannel, type InvokeChannels } from "@shared/ipc";
import { useBundledGit } from "./git";
import { Services } from "./services";
import { selectorScript } from "./preview/selector";

let mainWindow: BrowserWindow | null = null;

/**
 * Apps launched from Finder get a minimal PATH without Homebrew, nvm or Volta,
 * so npm and git would not be found. Read the login shell's PATH once at startup.
 */
function inheritShellPath(): void {
  if (process.platform === "win32") return;
  try {
    const shellBin = process.env.SHELL || "/bin/zsh";
    const out = execFileSync(shellBin, ["-ilc", 'printf "__ATELIER_PATH__%s__ATELIER_PATH__" "$PATH"'], {
      encoding: "utf8",
      timeout: 5000,
    });
    const match = /__ATELIER_PATH__(.*)__ATELIER_PATH__/.exec(out);
    if (match?.[1]) process.env.PATH = match[1];
  } catch {
    // Keep the inherited PATH.
  }
}

/** Brand assets ship in assets/atelier, at the app root in development and in the package. */
function brandAsset(rel: string): string {
  return path.join(app.getAppPath(), "assets/atelier", rel);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: "Atelier",
    // Windows and Linux; macOS takes the icon from the app bundle (or the dock, below).
    icon: brandAsset(process.platform === "win32" ? "windows/icon.ico" : "png/icon-512.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b0b0e" : "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // External links open in the browser; the window only shows the app UI.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

/** Preview screenshots are taken at a laptop viewport and stored at half width. */
const PREVIEW_VIEWPORT = { width: 1280, height: 800 };
const PREVIEW_SETTLE_MS = 1500;

/**
 * Loads the app's dev server in a hidden offscreen window and screenshots it,
 * so the capture never includes Atelier's own overlays or depends on the
 * workspace being open.
 */
async function capturePreview(url: string): Promise<Buffer | null> {
  const win = new BrowserWindow({
    ...PREVIEW_VIEWPORT,
    show: false,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // Stay on the dev server: redirects to other origins are not captured.
  const origin = originOf(url);
  win.webContents.on("will-navigate", (e, next) => {
    if (originOf(next) !== origin) e.preventDefault();
  });
  try {
    await win.loadURL(url);
    // Client-rendered apps paint after load.
    await new Promise((r) => setTimeout(r, PREVIEW_SETTLE_MS));
    if (win.isDestroyed()) return null;
    const image = await win.webContents.capturePage();
    if (image.isEmpty()) return null;
    return image.resize({ width: PREVIEW_VIEWPORT.width / 2, quality: "good" }).toJPEG(82);
  } catch {
    return null;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function emit<C extends keyof EventChannels>(channel: C, payload: EventChannels[C]): void {
  mainWindow?.webContents.send(channel, payload);
}

function registerHandlers(services: Services): void {
  type Handler<C extends InvokeChannel> = (...args: InvokeChannels[C]["args"]) => InvokeChannels[C]["result"] | Promise<InvokeChannels[C]["result"]>;
  const handlers: { [C in InvokeChannel]: Handler<C> } = {
    "settings:get": () => services.getSettings(),
    "settings:set": (patch) => services.setSettings(patch),
    "settings:configure-provider": (id, update) => services.configureProvider(id, update),
    "settings:detect-keychain-key": () => services.detectKeychainKey(),
    "settings:import-keychain-key": () => services.importKeychainKey(),
    "llm:models": (id) => services.listProviderModels(id),

    "ds:list": () => services.listDesignSystems(),
    "ds:get": (id) => services.getDesignSystem(id),
    "ds:import": (input) => services.importDesignSystem(input),
    "ds:update": (id, patch) => services.updateDesignSystem(id, patch),
    "ds:reimport": (id) => services.reimportDesignSystem(id),
    "ds:delete": (id) => services.deleteDesignSystem(id),
    "ds:preview-rules": (id) => services.previewRules(id),
    "ds:select-folder": async () => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: "Select the design system package folder",
        properties: ["openDirectory"],
      });
      return result.canceled ? null : result.filePaths[0];
    },

    "app:list": () => services.listApps(),
    "app:create": (input) => services.createApp(input),
    "app:delete": (id) => services.deleteApp(id),
    "app:rename": (id, name) => services.renameApp(id, name),
    "app:files": (id) => services.appFiles(id),
    "app:read-file": (id, rel) => services.readAppFile(id, rel),
    "app:write-file": (id, rel, content) => services.writeAppFile(id, rel, content),
    "app:managed-files": (id) => services.managedFiles(id),
    "app:reveal": (id) => shell.showItemInFolder(services.appPath(id)),
    "app:versions": (id) => services.versions(id),
    "app:restore-version": (id, hash) => services.restoreVersion(id, hash),
    "app:preview-image": (id) => services.previewImage(id),

    "chat:list": (appId) => services.listChats(appId),
    "chat:create": (appId) => services.createChat(appId),
    "chat:messages": (chatId) => services.messages(chatId),
    "chat:send": (input) => services.send(input),
    "chat:cancel": (chatId) => services.cancel(chatId),

    "templates:list": () => services.templates.list(),
    "templates:import": (source) => services.templates.import(source),
    "templates:update": (id, patch) => services.templates.update(id, patch),
    "templates:refresh": (id) => services.templates.refresh(id),
    "templates:delete": (id) => services.templates.remove(id),
    "templates:files": (id) => services.templates.files(id),
    "templates:select-folder": async () => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: "Select the starter app folder (it contains package.json)",
        properties: ["openDirectory"],
      });
      return result.canceled ? null : result.filePaths[0];
    },

    "connectors:list": () => services.connectors.list(),
    "connectors:save": (input) => services.connectors.save(input),
    "connectors:delete": (id) => services.connectors.remove(id),
    "connectors:connect": (id) => services.connectors.connect(id),
    "connectors:sign-out": (id) => services.connectors.signOut(id),
    "connectors:set-tool": (id, tool, enabled) => services.connectors.setTool(id, tool, enabled),

    "preview:select-mode": async (appId, enable) => {
      const status = services.runner.status(appId);
      if (status.state !== "running" || !mainWindow) return false;
      // Only the frame showing this app's own dev server gets the tool.
      const origin = new URL(status.url).origin;
      const main = mainWindow.webContents.mainFrame;
      const frame = main.framesInSubtree.find((f) => f !== main && originOf(f.url) === origin);
      if (!frame) return false;
      await frame.executeJavaScript(selectorScript(Boolean(enable)));
      return true;
    },

    "preview:save-edits": (appId, edits) => services.savePreviewEdits(appId, edits),

    "run:start": (id) => services.startApp(id),
    "run:stop": (id) => services.runner.stop(id),
    "run:restart": (id, opts) => services.restartApp(id, opts ?? {}),
    "run:status": (id) => services.runner.status(id),
  };

  for (const channel of INVOKE_CHANNELS) {
    const handler = handlers[channel] as (...args: unknown[]) => unknown;
    ipcMain.handle(channel, (event, ...args) => {
      // Only the app's own UI may call into the main process, never the preview iframe.
      if (event.senderFrame !== event.sender.mainFrame) throw new Error("IPC from subframes is not allowed");
      return handler(...args);
    });
  }
}

// The JSON store and dev-server ports are per machine, so only one window process may own them.
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
});

app.whenReady().then(() => {
  inheritShellPath();
  // An unpackaged run is Electron.app, whose dock icon is Electron's.
  if (process.platform === "darwin" && !app.isPackaged) app.dock?.setIcon(brandAsset("png/icon-512.png"));
  // Packaging copies resources/git into the app's Resources folder, like Node.js below.
  useBundledGit(app.isPackaged ? path.join(process.resourcesPath, "git") : path.join(app.getAppPath(), "resources/git"));
  const services = new Services({
    userDataDir: app.getPath("userData"),
    emit,
    capturePreview,
    fetch: (url) => net.fetch(url),
    // Packaging copies resources/node into the app's Resources folder (package.json "extraResources").
    bundledNodeDir: app.isPackaged ? path.join(process.resourcesPath, "node") : path.join(app.getAppPath(), "resources/node"),
    nodeMirror: process.env.ATELIER_NODE_MIRROR,
    openExternal: (url) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    },
    secrets: {
      encrypt: async (plain) => {
        if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error("OS keychain encryption is unavailable");
        return (await safeStorage.encryptStringAsync(plain)).toString("base64");
      },
      decrypt: async (cipher) => {
        const buf = Buffer.from(cipher, "base64");
        let { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(buf);
        if (shouldReEncrypt) ({ result } = await safeStorage.decryptStringAsync(buf));
        return result;
      },
    },
  });
  registerHandlers(services);
  createWindow();

  app.on("before-quit", () => {
    services.runner.stopAll();
    // Closes local MCP server processes.
    void services.connectors.manager.closeAll();
  });
  // A terminal Ctrl+C or kill skips before-quit; dev servers run in their own
  // process groups and would otherwise outlive the app.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      services.runner.stopAll();
      void services.connectors.manager.closeAll();
      app.quit();
    });
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
