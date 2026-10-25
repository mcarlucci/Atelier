/**
 * The model picker in the prompt boxes: the models chosen under Settings for
 * each provider (all of the active provider's when none are chosen), the
 * current one first, and a way to Settings. Picking another provider's model
 * switches the active provider.
 */
import { useEffect, useState } from "react";
import type { ProviderSettings, Settings } from "@shared/types";
import { providerPreset, type ProviderId } from "@shared/providers";
import { api, errorMessage } from "../api";
import { shortModelLabel } from "../format";
import { Icon } from "../ui/icons";
import { Menu, MenuItem, toast } from "../ui/slab";

const MAX_LISTED = 100;

/** A provider can be asked for models once it has a key, or needs none. */
const usable = (p: ProviderSettings) => p.hasApiKey || !providerPreset(p.id).needsKey;

export default function ModelMenu({ onOpenSettings }: { onOpenSettings(): void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.invoke("settings:get").then((s) => {
      if (cancelled) return;
      setSettings(s);
      const active = s.providers.find((p) => p.id === s.provider);
      if (active && (active.hasApiKey || !providerPreset(s.provider).needsKey)) {
        api.invoke("llm:models", s.provider).then(
          (r) => !cancelled && setModels(r.models),
          () => !cancelled && setModels([]),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const provider = settings ? providerPreset(settings.provider) : null;
  // The active provider first, then others that have models picked for the menu.
  const groups = settings
    ? settings.providers
        .filter((p) => usable(p) && (p.id === settings.provider || p.shownModels?.length))
        .sort((a, b) => Number(b.id === settings.provider) - Number(a.id === settings.provider))
        .map((p) => {
          const active = p.id === settings.provider;
          const offered = p.shownModels ?? (active ? (models ?? []) : []);
          const list = [...new Set([...(active && p.model ? [p.model] : []), ...offered])].slice(0, MAX_LISTED);
          return { id: p.id, label: providerPreset(p.id).label, active, models: list };
        })
        .filter((g) => g.models.length)
    : [];
  const label = !settings ? "Model" : settings.model ? shortModelLabel(settings.model) : models?.length ? "Choose a model" : "Set up a model";

  const choose = (id: ProviderId, model: string) =>
    (id === settings?.provider ? api.invoke("settings:set", { model }) : api.invoke("settings:configure-provider", id, { model, activate: true }))
      .then(setSettings)
      .catch((e) => toast(errorMessage(e), "danger"));

  return (
    <Menu
      label="Model"
      placement="top"
      anchor={
        <button
          className={`chip-btn${settings && !settings.ready ? " warn" : ""}`}
          aria-label={`Model: ${settings?.model || "not set"}${provider ? ` (${provider.label})` : ""}`}
          title={settings ? `${provider?.label}: ${settings.model || "no model chosen"}` : undefined}
        >
          <Icon name={provider?.local ? "monitor" : "sparkles"} size={13} />
          <span className="truncate">{label}</span>
          <Icon name="chevronDown" size={12} />
        </button>
      }
    >
      {groups.flatMap((g) => [
        ...(groups.length > 1
          ? [
              <MenuItem key={`${g.id}:heading`} disabled className="menu-heading" onSelect={() => {}}>
                {g.label}
              </MenuItem>,
            ]
          : []),
        ...g.models.map((m) => (
          <MenuItem
            key={`${g.id}:${m}`}
            label={groups.length > 1 ? `${m} (${g.label})` : m}
            className={g.active && m === settings?.model ? "current" : undefined}
            onSelect={() => void choose(g.id, m)}
          >
            <span className="truncate">{shortModelLabel(m)}</span>
          </MenuItem>
        )),
      ])}
      {models !== null && models.length === 0 && !settings?.model && !groups.length && (
        <MenuItem disabled onSelect={() => {}}>
          No models found
        </MenuItem>
      )}
      <MenuItem onSelect={onOpenSettings}>
        <Icon name="settings" size={14} />
        {provider ? `${provider.label} settings…` : "Settings…"}
      </MenuItem>
    </Menu>
  );
}
