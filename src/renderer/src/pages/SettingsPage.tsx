import { useEffect, useState } from "react";
import type { Settings } from "@shared/types";
import { api, errorMessage } from "../api";
import ProviderSettings from "../components/ProviderSettings";
import { applyTheme, useThemePreference, type ThemePreference } from "../format";
import { Icon } from "../ui/icons";
import { TextField, ToggleGroup, toast } from "../ui/slab";


export default function SettingsPage({ onChange }: { onChange(s: Settings): void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [folder, setFolder] = useState("");
  const theme = useThemePreference();

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
          <h2>AI model</h2>
          <p className="muted small">Pick a provider. Local providers are free and keep everything on this computer.</p>
        </div>
        <ProviderSettings settings={settings} onSettings={apply} />
      </section>

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
