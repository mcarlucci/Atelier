import { BrowserWindow } from "electron";
import type { ConsoleEntry, OpenPreview, PreviewPage } from "./page";

const DEFAULT_SIZE = { width: 1280, height: 800 };
/** Client-rendered apps paint after load. */
const SETTLE_MS = 1500;
const MAX_FULL_PAGE = 4000;
const LEVELS: ConsoleEntry["level"][] = ["log", "info", "warning", "error"];

/**
 * Opens the dev server in a hidden offscreen window: sandboxed, no Node.js, same origin only. It is a separate copy of
 * the page, so clicking and typing in it never touches the preview the user is looking at.
 */
export const openPreviewWindow: OpenPreview = async (url) => {
  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const wc = win.webContents;
  wc.setAudioMuted(true);
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  const origin = new URL(url).origin;
  wc.on("will-navigate", (e, next) => {
    try {
      if (new URL(next).origin !== origin) e.preventDefault();
    } catch {
      e.preventDefault();
    }
  });

  const entries: ConsoleEntry[] = [];
  // Electron 35+ passes one details object; older versions pass (level, message).
  wc.on("console-message", ((...args: unknown[]) => {
    const first = args[0] as { level?: unknown; message?: string } | undefined;
    const details = first && typeof first === "object" && "message" in first && first.message !== undefined ? first : { level: args[1], message: args[2] as string };
    const level = typeof details.level === "number" ? LEVELS[details.level] : (details.level as ConsoleEntry["level"] | undefined);
    // Electron's own warning about the dev server's missing Content-Security-Policy is not the app's problem.
    if (String(details.message ?? "").startsWith("Electron Security Warning")) return;
    entries.push({ level: level === "error" || level === "warning" || level === "info" ? level : "log", text: String(details.message ?? "") });
  }) as never);
  wc.on("did-fail-load", (_e, code, description, failedUrl) => {
    if (code !== -3) entries.push({ level: "error", text: `The page failed to load (${description}): ${failedUrl}` });
  });
  wc.on("render-process-gone", (_e, details) => entries.push({ level: "error", text: `The page crashed (${details.reason}).` }));

  await win.loadURL(url).catch((err: Error) => entries.push({ level: "error", text: err.message }));
  await new Promise((r) => setTimeout(r, SETTLE_MS));

  const page: PreviewPage = {
    async screenshot({ width, height, fullPage }) {
      let h = height;
      if (fullPage) {
        const full = await wc.executeJavaScript("Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)", true);
        h = Math.min(MAX_FULL_PAGE, Math.max(height, Number(full) || height));
      }
      win.setContentSize(width, h);
      await new Promise((r) => setTimeout(r, 400));
      const image = await wc.capturePage();
      if (image.isEmpty()) throw new Error("The page produced no image.");
      return image.toJPEG(80);
    },
    evaluate: (script) => wc.executeJavaScript(script, true),
    messages: () => entries,
    close() {
      if (!win.isDestroyed()) win.destroy();
    },
  };
  return page;
};
