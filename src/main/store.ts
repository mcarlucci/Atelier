import fs from "node:fs";
import path from "node:path";
import type { AppRecord, ChatRecord, DesignSystem, EffortLevel, MessageRecord } from "@shared/types";
import type { ProviderId } from "@shared/providers";
import type { ConnectorConfig } from "@shared/connectors";
import type { TemplateInfo } from "@shared/templates";

export interface PersistedSettings {
  /** Active provider; absent in stores written before providers existed. */
  provider?: ProviderId;
  /** Anthropic model. */
  model: string;
  effort: EffortLevel;
  appsFolder: string;
  /** Last design system and template picked on the home page. */
  lastDesignSystemId?: string;
  lastTemplateId?: string;
  /** Anthropic API key encrypted with Electron safeStorage, base64. */
  encryptedApiKey?: string;
  /** Other providers. Keys are encrypted like the Anthropic one. */
  providerConfigs?: Partial<Record<ProviderId, { baseUrl?: string; model?: string; encryptedApiKey?: string; contextLength?: number; shownModels?: string[] }>>;
}

export interface StoredConnector extends Omit<ConnectorConfig, "hasSecret"> {
  /** Bearer or Figma token, encrypted. */
  encryptedSecret?: string;
  /** JSON environment for a local server, encrypted. */
  encryptedEnv?: string;
  /** JSON OAuth client registration, tokens and PKCE verifier, encrypted. */
  encryptedOAuth?: string;
}

export interface StoreData {
  version: 1;
  settings: PersistedSettings;
  designSystems: DesignSystem[];
  apps: AppRecord[];
  chats: ChatRecord[];
  messages: MessageRecord[];
  /** Absent in stores written before connectors existed. */
  connectors?: StoredConnector[];
  /** Custom sandbox templates; their files live in userData/templates/<id>. */
  templates?: TemplateInfo[];
}

/**
 * Small JSON document store. A JSON file avoids shipping a native module such
 * as better-sqlite3 and is enough for local, single-user data.
 */
export class Store {
  private data: StoreData;

  constructor(
    private readonly file: string,
    defaults: PersistedSettings,
  ) {
    this.data = this.load(defaults);
  }

  private load(defaults: PersistedSettings): StoreData {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as StoreData;
      return { ...raw, settings: { ...defaults, ...raw.settings } };
    } catch {
      return { version: 1, settings: defaults, designSystems: [], apps: [], chats: [], messages: [] };
    }
  }

  get(): Readonly<StoreData> {
    return this.data;
  }

  update(mutator: (data: StoreData) => void): void {
    mutator(this.data);
    this.flush();
  }

  private flush(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

export function newId(): string {
  return crypto.randomUUID();
}
