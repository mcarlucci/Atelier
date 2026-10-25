import type { AppRecord } from "@shared/types";
import { hueFor, initials } from "../format";

export default function AppAvatar({ app, size = 32 }: { app: Pick<AppRecord, "id" | "name">; size?: number }) {
  const hue = hueFor(app.id);
  return (
    <span
      className="app-avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: `linear-gradient(135deg, hsl(${hue} 70% 60%), hsl(${(hue + 40) % 360} 70% 48%))`,
      }}
    >
      {initials(app.name)}
    </span>
  );
}
