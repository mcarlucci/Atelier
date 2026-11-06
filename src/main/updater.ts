import type { UpdateState } from "../shared/types";

/** The slice of electron-updater's AppUpdater that UpdateService uses. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (arg: { version?: string; percent?: number; message?: string }) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}

const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

/** Checks GitHub Releases for a newer build, downloads it in the background, and installs on request. */
export class UpdateService {
  private state: UpdateState;

  /** Pass no `updater` (dev builds) and every method is a no-op. */
  constructor(
    private readonly opts: { updater?: UpdaterLike; currentVersion: string; emit(state: UpdateState): void },
  ) {
    this.state = { status: "idle", currentVersion: opts.currentVersion };
    const u = opts.updater;
    if (!u) return;
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;
    u.on("checking-for-update", () => this.set({ status: "checking" }));
    u.on("update-available", (i) => this.set({ status: "downloading", version: i.version, percent: 0 }));
    u.on("update-not-available", () => this.set({ status: "idle" }));
    u.on("download-progress", (p) => this.set({ status: "downloading", version: this.state.version, percent: Math.round(p.percent ?? 0) }));
    u.on("update-downloaded", (i) => this.set({ status: "ready", version: i.version }));
    // A failed check must not hide an update that is already downloaded.
    u.on("error", (e) => this.state.status !== "ready" && this.set({ status: "error", error: e.message?.split("\n")[0] }));
  }

  get(): UpdateState {
    return this.state;
  }

  /** Checks now, unless a download is already running or finished. */
  async check(): Promise<UpdateState> {
    const u = this.opts.updater;
    if (!u || this.state.status === "downloading" || this.state.status === "ready") return this.state;
    try {
      await u.checkForUpdates();
    } catch {
      // The "error" event already recorded it.
    }
    return this.state;
  }

  /** Checks shortly after launch, then every few hours. */
  start(): void {
    if (!this.opts.updater) return;
    setTimeout(() => void this.check(), FIRST_CHECK_MS).unref();
    setInterval(() => void this.check(), CHECK_EVERY_MS).unref();
  }

  install(): void {
    if (this.state.status === "ready") this.opts.updater?.quitAndInstall();
  }

  private set(patch: Omit<UpdateState, "currentVersion">): void {
    this.state = { currentVersion: this.opts.currentVersion, ...patch };
    this.opts.emit(this.state);
  }
}
