import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { UpdateService, type UpdaterLike } from "../src/main/updater";
import type { UpdateState } from "../src/shared/types";

function setup() {
  const ev = new EventEmitter();
  const updater = Object.assign(ev, {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(async () => {}),
    quitAndInstall: vi.fn(),
  }) as unknown as UpdaterLike & EventEmitter & { checkForUpdates: ReturnType<typeof vi.fn>; quitAndInstall: ReturnType<typeof vi.fn> };
  const states: UpdateState[] = [];
  const svc = new UpdateService({ updater, currentVersion: "1.0.0", emit: (s) => states.push(s) });
  return { updater, svc, states };
}

describe("UpdateService", () => {
  it("walks from download to ready and installs on request", async () => {
    const { updater, svc, states } = setup();
    expect(updater.autoDownload).toBe(true);
    updater.emit("update-available", { version: "1.1.0" });
    updater.emit("download-progress", { percent: 41.6 });
    expect(svc.get()).toMatchObject({ status: "downloading", version: "1.1.0", percent: 42 });
    svc.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    updater.emit("update-downloaded", { version: "1.1.0" });
    expect(svc.get()).toMatchObject({ status: "ready", version: "1.1.0", currentVersion: "1.0.0" });
    svc.install();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
    expect(states.at(-1)?.status).toBe("ready");
  });

  it("records only the first line of an error, and a ready update survives one", () => {
    const { updater, svc } = setup();
    updater.emit("error", { message: "net down\nstack" });
    expect(svc.get()).toMatchObject({ status: "error", error: "net down" });
    updater.emit("update-downloaded", { version: "1.1.0" });
    updater.emit("error", { message: "later failure" });
    expect(svc.get().status).toBe("ready");
  });

  it("skips a check while downloading or ready", async () => {
    const { updater, svc } = setup();
    await svc.check();
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    updater.emit("update-available", { version: "1.1.0" });
    await svc.check();
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
  });

  it("does nothing without an updater (dev builds)", async () => {
    const svc = new UpdateService({ currentVersion: "dev", emit: () => {} });
    expect(await svc.check()).toEqual({ status: "idle", currentVersion: "dev" });
    svc.install();
    svc.start();
  });
});
