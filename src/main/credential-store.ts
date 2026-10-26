import { run, type RunResult } from "./process";

/** Names looked up, in order, as the service (macOS) or target (Windows) of a generic credential. */
export const KEY_ITEM_NAMES = ["Atelier", "anthropic", "ANTHROPIC_API_KEY", "anthropic-api-key"];

type Runner = (command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => Promise<RunResult>;

export interface KeychainKeyInfo {
  found: boolean;
  /** Where it was found, for display. */
  source?: string;
}

const API_KEY = /^sk-ant-\S+$/;

/** Reads a generic credential's blob as base64 and exits 1 when it is missing. Output only when ATELIER_CRED_READ=1. */
const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AtelierCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDENTIAL {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredRead(string target, uint type, uint flags, out IntPtr cred);
  [DllImport("advapi32.dll")]
  static extern void CredFree(IntPtr cred);
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return null;
    try {
      var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      var b = new byte[c.CredentialBlobSize];
      Marshal.Copy(c.CredentialBlob, b, 0, b.Length);
      return Convert.ToBase64String(b);
    } finally { CredFree(p); }
  }
}
'@
$r = [AtelierCred]::Read($env:ATELIER_CRED_TARGET)
if ($null -eq $r) { exit 1 }
if ($env:ATELIER_CRED_READ -eq '1') { [Console]::Out.Write($r) }
`;

const WINDOWS_ARGS = ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64")];

function source(platform: NodeJS.Platform): string | undefined {
  return platform === "darwin" ? "Keychain" : platform === "win32" ? "Credential Manager" : undefined;
}

/** Windows tools store passwords as UTF-16 (cmdkey) or UTF-8 (most others). */
function decodeBlob(base64: string): string | undefined {
  const blob = Buffer.from(base64.trim(), "base64");
  return [blob.toString("utf16le"), blob.toString("utf8")].map((s) => s.trim()).find((s) => API_KEY.test(s));
}

async function readItem(name: string, read: boolean, platform: NodeJS.Platform, runner: Runner): Promise<string | undefined | null> {
  try {
    if (platform === "darwin") {
      // Without -w the command prints attributes only, so it never asks to unlock the secret.
      const r = await runner("security", ["find-generic-password", "-s", name, ...(read ? ["-w"] : [])]);
      if (r.code !== 0) return null;
      return read ? r.stdout.trim() : "";
    }
    const r = await runner("powershell.exe", WINDOWS_ARGS, {
      env: { ...process.env, ATELIER_CRED_TARGET: name, ATELIER_CRED_READ: read ? "1" : "0" },
    });
    if (r.code !== 0) return null;
    return read ? decodeBlob(r.stdout) : "";
  } catch {
    // The tool is missing or could not start.
    return null;
  }
}

/** Checks for a stored key without reading it. */
export async function findKeychainKey(platform: NodeJS.Platform = process.platform, runner: Runner = run): Promise<KeychainKeyInfo> {
  const label = source(platform);
  if (!label) return { found: false };
  for (const name of KEY_ITEM_NAMES) {
    if ((await readItem(name, false, platform, runner)) !== null) return { found: true, source: label };
  }
  return { found: false };
}

/** The first stored value that looks like an Anthropic API key. May show an OS access prompt. */
export async function readKeychainKey(platform: NodeJS.Platform = process.platform, runner: Runner = run): Promise<string | undefined> {
  if (!source(platform)) return undefined;
  for (const name of KEY_ITEM_NAMES) {
    const value = await readItem(name, true, platform, runner);
    if (value && API_KEY.test(value)) return value;
  }
  return undefined;
}
