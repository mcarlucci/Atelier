import { useEffect, useRef, useState } from "react";
import type { Settings } from "@shared/types";
import type { Route } from "../App";
import { TabPanel, Tabs } from "../ui/slab";
import ConnectorsPage from "./ConnectorsPage";
import DesignSystemsPage from "./DesignSystemsPage";
import SettingsPage from "./SettingsPage";
import TemplatesPage from "./TemplatesPage";

export type SettingsRoute = Extract<Route, { page: "settings" | "design-systems" | "templates" | "connectors" }>;

export const SETTINGS_PAGES: readonly SettingsRoute["page"][] = ["settings", "design-systems", "templates", "connectors"];

const TABS: { id: SettingsRoute["page"]; label: string }[] = [
  { id: "settings", label: "General" },
  { id: "design-systems", label: "Design systems" },
  { id: "templates", label: "Templates" },
  { id: "connectors", label: "Connectors" },
];

/** Settings, with design systems, templates and connectors as tabs. Each tab keeps its own route. */
export default function SettingsShell({
  route,
  navigate,
  onSettings,
}: {
  route: SettingsRoute;
  navigate(r: Route): void;
  onSettings(s: Settings): void;
}) {
  // Slab owns the selected tab after mounting, so a route change from outside the tabs
  // (the rail's model warning, a link from another page) remounts them on the new tab.
  const shown = useRef(route.page);
  const [syncKey, setSyncKey] = useState(0);
  useEffect(() => {
    if (shown.current === route.page) return;
    shown.current = route.page;
    setSyncKey((k) => k + 1);
  }, [route.page]);

  const selectedId = "selectedId" in route ? route.selectedId : undefined;
  return (
    <div className="settings-shell">
      <h1 className="settings-title">Settings</h1>
      <Tabs
        key={syncKey}
        label="Settings sections"
        className="settings-tabs"
        value={route.page}
        tabs={TABS}
        onValue={(id) => {
          shown.current = id as SettingsRoute["page"];
          navigate({ page: id as SettingsRoute["page"] });
        }}
      >
        {TABS.map((t) => (
          <TabPanel key={t.id} name={t.id} className="tab-body">
            {/* Only the open tab renders, so each page loads its data when it is shown. */}
            {route.page === t.id &&
              (t.id === "settings" ? (
                <SettingsPage onChange={onSettings} />
              ) : t.id === "design-systems" ? (
                <DesignSystemsPage selectedId={selectedId} navigate={navigate} />
              ) : t.id === "templates" ? (
                <TemplatesPage selectedId={selectedId} navigate={navigate} />
              ) : (
                <ConnectorsPage selectedId={selectedId} navigate={navigate} />
              ))}
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}
