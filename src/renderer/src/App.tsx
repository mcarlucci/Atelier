import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppRecord, Settings } from "@shared/types";
import { api } from "./api";
import appIconUrl from "../../../assets/atelier/svg/atelier-app-icon.svg";
import AppAvatar from "./components/AppAvatar";
import { applyTheme, relativeTime, useThemePreference } from "./format";
import AppsPage from "./pages/AppsPage";
import SettingsShell, { SETTINGS_PAGES, type SettingsRoute } from "./pages/SettingsShell";
import WorkspacePage from "./pages/WorkspacePage";
import { Icon, type IconName } from "./ui/icons";
import { Menu, MenuItem, TextField, ToastHost, Tooltip } from "./ui/slab";

export type Route =
  | { page: "apps" }
  | { page: "workspace"; appId: string; initialPrompt?: string }
  | { page: "design-systems"; selectedId?: string }
  | { page: "connectors"; selectedId?: string }
  | { page: "templates"; selectedId?: string }
  | { page: "settings" };

export default function App() {
  const [route, setRoute] = useState<Route>({ page: "apps" });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apps, setApps] = useState<AppRecord[]>([]);
  const theme = useThemePreference();

  const refreshApps = useCallback(() => void api.invoke("app:list").then(setApps), []);

  useEffect(() => {
    void api.invoke("settings:get").then(setSettings);
    refreshApps();
  }, [route, refreshApps]);

  useEffect(() => api.on("chat:done", refreshApps), [refreshApps]);

  const railItem = (label: string, icon: IconName, target: Route, active: boolean) => (
    <Tooltip label={label} placement="right">
      <button className="rail-item" aria-label={label} aria-current={active ? "page" : undefined} onClick={() => setRoute(target)}>
        <Icon name={icon} size={18} />
      </button>
    </Tooltip>
  );

  const showAppList = route.page === "apps";
  const inSettings = (SETTINGS_PAGES as readonly string[]).includes(route.page);

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <img className="logo" src={appIconUrl} alt="" aria-hidden="true" />
        {railItem("Apps", "home", { page: "apps" }, route.page === "apps" || route.page === "workspace")}
        <div className="rail-foot">
          {settings && !settings.ready && (
            <Tooltip label="Set up an AI model" placement="right">
              <button className="rail-item warn" aria-label="Set up an AI model" onClick={() => setRoute({ page: "settings" })}>
                <Icon name="key" size={18} />
                <span className="rail-dot" />
              </button>
            </Tooltip>
          )}
          {/* <Menu
            label="Theme"
            placement="right"
            anchor={
              <button className="rail-item" aria-label={`Theme: ${theme}`} title="Theme">
                <Icon name={theme === "light" ? "sun" : theme === "dark" ? "moon" : "monitor"} size={18} />
              </button>
            }
          >
            {(["light", "dark", "system"] as const).map((t) => (
              <MenuItem key={t} onSelect={() => applyTheme(t)} className={t === theme ? "current" : undefined}>
                <Icon name={t === "light" ? "sun" : t === "dark" ? "moon" : "monitor"} size={14} />
                {t[0].toUpperCase() + t.slice(1)}
              </MenuItem>
            ))}
          </Menu> */}
          {/* Already in Settings: stay on the open tab. */}
          {railItem("Settings", "settings", inSettings ? route : { page: "settings" }, inSettings)}
        </div>
      </nav>

      {/* {showAppList && <AppList apps={apps} navigate={setRoute} />} */}

      <main className="content">
        {route.page === "apps" && <AppsPage apps={apps} onAppsChanged={refreshApps} navigate={setRoute} />}
        {route.page === "workspace" && (
          <WorkspacePage key={route.appId} appId={route.appId} initialPrompt={route.initialPrompt} navigate={setRoute} />
        )}
        {inSettings && <SettingsShell route={route as SettingsRoute} navigate={setRoute} onSettings={setSettings} />}
      </main>
      <ToastHost />
    </div>
  );
}

function AppList({ apps, navigate }: { apps: AppRecord[]; navigate(r: Route): void }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () =>
      [...apps]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase())),
    [apps, query],
  );
  return (
    <aside className="app-list" aria-label="Your apps">
      <div className="app-list-head">
        <span className="app-list-title">Apps</span>
        <button className="new-app" onClick={() => navigate({ page: "apps" })}>
          <Icon name="plus" size={14} />
          New app
        </button>
      </div>
      {apps.length > 4 && (
        <TextField className="app-search" type="search" label="Search apps" hideLabel placeholder="Search apps" value={query} onValue={setQuery} />
      )}
      <div className="app-list-items">
        {visible.map((a) => (
          <button
            key={a.id}
            className="app-list-item"
            onClick={() => navigate({ page: "workspace", appId: a.id })}
          >
            <AppAvatar app={a} size={28} />
            <span className="app-list-text">
              <span className="truncate">{a.name}</span>
              <span className="muted small">{relativeTime(a.updatedAt)}</span>
            </span>
          </button>
        ))}
        {apps.length === 0 && <p className="muted small app-list-empty">No apps yet. Describe one to get started.</p>}
        {apps.length > 0 && visible.length === 0 && <p className="muted small app-list-empty">No apps match “{query}”.</p>}
      </div>
    </aside>
  );
}
