import { spawn, type SpawnOptions } from "node:child_process";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a command to completion. Never uses a shell; arguments are passed as an array. */
export function run(
  command: string,
  args: string[],
  options: SpawnOptions & { onOutput?: (stream: "stdout" | "stderr", text: string) => void } = {},
): Promise<RunResult> {
  const { onOutput, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...spawnOptions, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      const text = d.toString();
      stdout += text;
      onOutput?.("stdout", text);
    });
    child.stderr?.on("data", (d: Buffer) => {
      const text = d.toString();
      stderr += text;
      onOutput?.("stderr", text);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

export async function runOrThrow(
  command: string,
  args: string[],
  options: Parameters<typeof run>[2] = {},
): Promise<string> {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    const tail = (result.stderr || result.stdout).trim().split("\n").slice(-15).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.code}):\n${tail}`);
  }
  return result.stdout;
}

/** npm on Windows is `npm.cmd`. */
export const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

/** npx on Windows is `npx.cmd`. */
export const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

let nodeVersion: Promise<string | undefined> | undefined;

/** The Node.js on PATH (which runs app dev servers), not Electron's. Cached; undefined if it isn't found. */
export function systemNodeVersion(): Promise<string | undefined> {
  nodeVersion ??= run(process.platform === "win32" ? "node.exe" : "node", ["--version"])
    .then((r) => (r.code === 0 ? r.stdout.trim().replace(/^v/, "") : undefined))
    .catch(() => undefined);
  return nodeVersion;
}
