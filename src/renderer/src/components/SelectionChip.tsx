import type { SelectedElement } from "@shared/types";
import { Icon } from "../ui/icons";

/** Compact description of a preview element picked with the selection tool. */
export default function SelectionChip({ selection: s, onClear }: { selection: SelectedElement; onClear?(): void }) {
  const text = s.text.length > 48 ? `${s.text.slice(0, 48)}…` : s.text;
  return (
    <div className="selection-chip" title={s.html}>
      <Icon name="pointer" size={13} />
      <code>&lt;{s.tag}&gt;</code>
      {text && <span className="truncate">“{text}”</span>}
      {s.components[0] && <span className="muted truncate">in {s.file ?? s.components[0]}</span>}
      {onClear && (
        <button className="icon-btn sm-icon" aria-label="Clear selection" title="Clear selection" onClick={onClear}>
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  );
}
