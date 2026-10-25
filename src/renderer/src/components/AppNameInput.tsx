import { useEffect, useRef, useState } from "react";
import type { AppRecord } from "@shared/types";
import { api, errorMessage } from "../api";
import { toast } from "../ui/slab";

/**
 * Inline editor for an app's name. Enter or leaving the field saves, Escape
 * cancels. An empty or unchanged name saves nothing.
 */
export default function AppNameInput({ app, onDone }: { app: AppRecord; onDone(updated?: AppRecord): void }) {
  const [value, setValue] = useState(app.name);
  const ref = useRef<HTMLInputElement>(null);
  // Enter saves and then blurs; this keeps the blur from saving a second time.
  const finished = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = async (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const name = value.trim();
    if (!save || !name || name === app.name) return onDone();
    try {
      onDone(await api.invoke("app:rename", app.id, name));
    } catch (e) {
      toast(errorMessage(e), "danger");
      onDone();
    }
  };

  return (
    <input
      ref={ref}
      className="name-input"
      aria-label="App name"
      value={value}
      maxLength={80}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") void finish(true);
        if (e.key === "Escape") void finish(false);
      }}
      onBlur={() => void finish(true)}
    />
  );
}
