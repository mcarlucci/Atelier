import { useEffect, useState } from "react";
import type { Settings, UpdateState } from "@shared/types";
import { api, errorMessage } from "../api";
import ProviderSettings, { PromptModels } from "../components/ProviderSettings";
import { applyTheme, useThemePreference, type ThemePreference } from "../format";
import { Icon } from "../ui/icons";
import { TextField, ToggleGroup, toast } from "../ui/slab";


export default function SettingsPage({ onChange }: { onChange(s: Settings): void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [folder, setFolder] = useState("");
  const theme = useThemePreference();
  const [update, setUpdate] = useState<UpdateState | null>(null);

  useEffect(() => {
    void api.invoke("update:state").then(setUpdate);
    return api.on("update:state", setUpdate);
  }, []);

  useEffect(() => {
    void api.invoke("settings:get").then((s) => {
      setSettings(s);
      setFolder(s.appsFolder);
    });
  }, []);

  const apply = (s: Settings, note?: string) => {
    setSettings(s);
    onChange(s);
    if (note) toast(note, "success");
  };
  const fail = (e: unknown) => toast(errorMessage(e), "danger");

  if (!settings) return null;
  return (
    <div className="page-scroll narrow">
      <section className="card form">
        <h2>Version</h2>
        <p className="muted small">
          Atelier {update?.currentVersion}. {updateText(update)}
        </p>
        <button
          disabled={update?.status === "checking" || update?.status === "downloading"}
          onClick={() => api.invoke("update:check").then(setUpdate, fail)}
        >
          Check for updates
        </button>
      </section>

      <section className="card form">
        <h2>Appearance</h2>
        <ToggleGroup
          label="Theme"
          value={theme}
          onValue={(v) => applyTheme(v as ThemePreference)}
          options={[
            { value: "light", label: "Light", content: <span className="tab-label"><Icon name="sun" size={14} />Light</span> },
            { value: "dark", label: "Dark", content: <span className="tab-label"><Icon name="moon" size={14} />Dark</span> },
            { value: "system", label: "System", content: <span className="tab-label"><Icon name="monitor" size={14} />System</span> },
          ]}
        />
      </section>

      <section className="card form">
        <div>
          <h2>AI providers</h2>
          <p className="muted small">Connect one or more providers. Select a tile to set it up; a green check means it is ready. Local providers are free and keep everything on this computer.</p>
        </div>
        <ProviderSettings settings={settings} onSettings={apply} />
      </section>

      <PromptModels settings={settings} onSettings={apply} />

      <section className="card form">
        <h2>Apps folder</h2>
        <TextField
          label="Folder"
          value={folder}
          onValue={setFolder}
          description="New apps are created here as git repositories."
          onCommit={(value) =>
            value !== settings.appsFolder &&
            api.invoke("settings:set", { appsFolder: value }).then((s) => apply(s, "Apps folder updated."), fail)
          }
        />
      </section>
    </div>
  );
}

function updateText(u: UpdateState | null): string {
  switch (u?.status) {
    case "checking":
      return "Checking for updates…";
    case "downloading":
      return `Downloading ${u.version}${u.percent ? ` (${u.percent}%)` : ""}…`;
    case "ready":
      return `${u.version} is ready. Restart from the sidebar to install it.`;
    case "error":
      return `Could not check for updates: ${u.error ?? "unknown error"}`;
    default:
      return "You're up to date.";
  }
}
