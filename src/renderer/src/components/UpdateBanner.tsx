import { useEffect, useState } from "react";
import type { UpdateState } from "@shared/types";
import { api } from "../api";
import { Icon } from "../ui/icons";
import { Tooltip } from "../ui/slab";

/** Rail button shown once a new version is downloading or ready to install. */
export default function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateState | null>(null);
  useEffect(() => {
    void api.invoke("update:state").then(setUpdate);
    return api.on("update:state", setUpdate);
  }, []);

  if (update?.status === "downloading") {
    const label = `Downloading update${update.version ? ` ${update.version}` : ""}…`;
    return (
      <Tooltip label={label} placement="right">
        <button className="rail-item" aria-label={label} disabled>
          <Icon name="refresh" size={18} />
        </button>
      </Tooltip>
    );
  }
  if (update?.status !== "ready") return null;
  const label = `Restart to update to ${update.version}`;
  return (
    <Tooltip label={label} placement="right">
      <button className="rail-item warn" aria-label={label} onClick={() => void api.invoke("update:install")}>
        <Icon name="refresh" size={18} />
        <span className="rail-dot" />
      </button>
    </Tooltip>
  );
}
