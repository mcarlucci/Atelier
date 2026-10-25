import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gitCommitAll, gitEnv, gitInit, gitLog, runGit, useBundledGit } from "../src/main/git";

// Fetched by `npm run fetch-git`; the test is skipped without it.
const root = path.join(import.meta.dirname, "..", "resources", "git");
const dir = path.join(root, `${process.platform}-${process.arch}`);
const fetched = fs.existsSync(dir);

describe.skipIf(!fetched)("bundled git", () => {
  useBundledGit(root);

  it("puts the bundled git first on PATH and sets its exec path", () => {
    const env = gitEnv({ PATH: "/usr/bin" });
    const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH")!;
    expect(env[key]!.split(path.delimiter)[0].startsWith(dir)).toBe(true);
    expect(env.GIT_EXEC_PATH!.startsWith(dir)).toBe(true);
  });

  it("runs the bundled build, not the git on PATH", async () => {
    const execPath = (await runGit(["--exec-path"])).trim();
    expect(path.resolve(execPath).startsWith(path.resolve(dir))).toBe(true);
  });

  it("creates versions with it", async () => {
    const app = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-git-"));
    try {
      await gitInit(app);
      fs.writeFileSync(path.join(app, "a.txt"), "hello\n");
      const hash = await gitCommitAll(app, "First version");
      expect(hash).toMatch(/^[0-9a-f]{40}$/);
      expect((await gitLog(app)).map((v) => v.message)).toEqual(["First version"]);
    } finally {
      fs.rmSync(app, { recursive: true, force: true });
    }
  });
});
