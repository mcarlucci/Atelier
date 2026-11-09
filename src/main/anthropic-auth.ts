import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** How the Anthropic SDK will authenticate when Atelier hands it no API key. */
export interface FederatedAuth {
  kind: "token" | "federation" | "profile";
  /** Short text for the settings screen. */
  source: string;
}

/** The SDK's config folder (`ANTHROPIC_CONFIG_DIR`, then the platform default). Mirrors its own lookup. */
function configDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string | null {
  if (env.ANTHROPIC_CONFIG_DIR) return env.ANTHROPIC_CONFIG_DIR;
  if (platform === "win32") return path.join(env.APPDATA || path.join(env.USERPROFILE || home, "AppData", "Roaming"), "Anthropic");
  return env.XDG_CONFIG_HOME ? path.join(env.XDG_CONFIG_HOME, "anthropic") : path.join(home, ".config", "anthropic");
}

/**
 * Detects credentials an organization manages for the user (workload identity federation, OAuth
 * profiles, a gateway token) that the SDK resolves on its own. Reads no secret: it checks that
 * variables are set and that the active profile's config file exists.
 */
export function detectFederatedAuth(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): FederatedAuth | null {
  if (env.ANTHROPIC_AUTH_TOKEN) return { kind: "token", source: "ANTHROPIC_AUTH_TOKEN" };
  const dir = configDir(env, platform, home);
  const profileExists = (name: string) => Boolean(dir) && fs.existsSync(path.join(dir!, "configs", `${name}.json`));
  if (env.ANTHROPIC_PROFILE) return { kind: "profile", source: `profile ${env.ANTHROPIC_PROFILE}` };
  if (env.ANTHROPIC_FEDERATION_RULE_ID && env.ANTHROPIC_ORGANIZATION_ID && (env.ANTHROPIC_IDENTITY_TOKEN_FILE || env.ANTHROPIC_IDENTITY_TOKEN)) {
    return { kind: "federation", source: "workload identity federation" };
  }
  if (!dir) return null;
  let active = "default";
  try {
    active = fs.readFileSync(path.join(dir, "active_config"), "utf8").trim() || "default";
  } catch {
    // No active_config file: the SDK uses "default".
  }
  return profileExists(active) ? { kind: "profile", source: `profile ${active}` } : null;
}
