/**
 * React bindings for Slab (https://slab-elements.dev), the headless Web
 * Component library Atelier's UI is built on. Slab supplies behavior (keyboard,
 * focus, ARIA, forms); the look lives in theme.css through ::part() and
 * :state(). Following Slab's React guidance, properties are set and events
 * are attached through refs.
 */
import "slab-elements/alert.js";
import "slab-elements/checkbox.js";
import "slab-elements/dialog.js";
import "slab-elements/disclosure.js";
import "slab-elements/listbox.js";
import "slab-elements/menu.js";
import "slab-elements/menu.item.js";
import "slab-elements/option.js";
import "slab-elements/pagination.js";
import "slab-elements/progress.js";
import "slab-elements/select.js";
import "slab-elements/tabs.js";
import "slab-elements/tabs.panel.js";
import "slab-elements/tabs.tab.js";
import "slab-elements/text-field.js";
import "slab-elements/textarea.js";
import "slab-elements/toast.js";
import "slab-elements/toggle-group.js";
import "slab-elements/toggle-group.button.js";
import "slab-elements/toolbar.js";
import "slab-elements/tooltip.js";
import "slab-elements/tree.js";
import "slab-elements/tree.item.js";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
  type ReactNode,
  type RefObject,
} from "react";

type Writable = HTMLElement & Record<string, unknown>;

/** Keeps a DOM property in sync with a React value without clobbering user input. */
function useProperty(ref: RefObject<HTMLElement | null>, name: string, value: unknown): void {
  useLayoutEffect(() => {
    const el = ref.current as Writable | null;
    if (el && value !== undefined && el[name] !== value) el[name] = value;
  }, [ref, name, value]);
}

/**
 * Listens for `type` on the element. Events bubbling up from Slab elements
 * nested inside it (a field's `change` inside tabs or a dialog) are ignored,
 * unless `fromChildren` is set for events that come from its own content.
 */
function useEvent(
  ref: RefObject<HTMLElement | null>,
  type: string,
  handler?: (el: Writable, event: Event) => void,
  { fromChildren = false }: { fromChildren?: boolean } = {},
): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const el = ref.current as Writable | null;
    if (!el) return;
    const listener = (event: Event) => {
      if (!fromChildren && event.target !== el) return;
      latest.current?.(el, event);
    };
    el.addEventListener(type, listener);
    return () => el.removeEventListener(type, listener);
  }, [ref, type, fromChildren]);
}

// ---------------------------------------------------------------- fields

interface TextInputProps {
  label: string;
  value: string;
  onValue?(value: string): void;
  /** Fires on commit (blur or Enter), like a native change event. */
  onCommit?(value: string): void;
  placeholder?: string;
  hideLabel?: boolean;
  disabled?: boolean;
  description?: ReactNode;
  className?: string;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
}

export function TextField({ type = "text", ...props }: TextInputProps & { type?: "text" | "password" | "url" | "search" }) {
  const ref = useRef<HTMLElement>(null);
  useProperty(ref, "value", props.value);
  useEvent(ref, "input", (el) => props.onValue?.(String(el.value)));
  useEvent(ref, "change", (el) => props.onCommit?.(String(el.value)));
  return (
    <slab-text-field
      ref={ref}
      class={props.className}
      label={props.label}
      type={type}
      placeholder={props.placeholder}
      hide-label={props.hideLabel || undefined}
      disabled={props.disabled || undefined}
      onKeyDown={props.onKeyDown}
    >
      {props.description && <span slot="description">{props.description}</span>}
    </slab-text-field>
  );
}

export function TextArea({ rows = 4, ...props }: TextInputProps & { rows?: number }) {
  const ref = useRef<HTMLElement>(null);
  useProperty(ref, "value", props.value);
  useEvent(ref, "input", (el) => props.onValue?.(String(el.value)));
  useEvent(ref, "change", (el) => props.onCommit?.(String(el.value)));
  return (
    <slab-textarea
      ref={ref}
      class={props.className}
      label={props.label}
      rows={rows}
      placeholder={props.placeholder}
      hide-label={props.hideLabel || undefined}
      disabled={props.disabled || undefined}
      onKeyDown={props.onKeyDown}
    >
      {props.description && <span slot="description">{props.description}</span>}
    </slab-textarea>
  );
}

export interface Choice {
  value: string;
  label: string;
  /** Shown in place of the label, which then only names the choice (e.g. an icon). */
  content?: ReactNode;
  disabled?: boolean;
}

interface SelectProps {
  label: string;
  value: string;
  options: Choice[];
  onValue(value: string): void;
  hideLabel?: boolean;
  placeholder?: string;
  className?: string;
}

export function Select(props: SelectProps) {
  // Slab does not re-render the shown label when an Option's text changes, so a
  // new option list remounts the whole wrapper. Keying only the element would
  // leave the change listener on the old one.
  return <SelectInner key={props.options.map((o) => `${o.value}=${o.label}`).join("|")} {...props} />;
}

function SelectInner(props: SelectProps) {
  const ref = useRef<HTMLElement>(null);
  useEvent(ref, "change", (el) => props.onValue(String(el.value)));
  // Options must exist before the value can select one.
  useLayoutEffect(() => {
    const el = ref.current as Writable | null;
    if (el && el.value !== props.value) el.value = props.value;
  });
  return (
    <slab-select
      ref={ref}
      class={props.className}
      label={props.label}
      placeholder={props.placeholder}
      hide-label={props.hideLabel || undefined}
    >
      {props.options.length === 0 ? (
        // Slab requires at least one Option.
        <slab-option value="" disabled>
          {props.placeholder ?? "No options"}
        </slab-option>
      ) : (
        props.options.map((o) => (
          <slab-option key={o.value} value={o.value} disabled={o.disabled || undefined}>
            {o.label}
          </slab-option>
        ))
      )}
    </slab-select>
  );
}

export function Listbox(props: { label: string; value: string | null; options: Choice[]; onValue(value: string): void; className?: string }) {
  // Slab requires at least one Option, so an empty list renders nothing.
  if (props.options.length === 0) return <div className={props.className} />;
  return <ListboxInner {...props} />;
}

function ListboxInner(props: { label: string; value: string | null; options: Choice[]; onValue(value: string): void; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEvent(ref, "change", (el) => props.onValue(String(el.value)));
  useLayoutEffect(() => {
    const el = ref.current as Writable | null;
    if (el && props.value !== null && el.value !== props.value) el.value = props.value;
  });
  return (
    <slab-listbox ref={ref} class={props.className} label={props.label} hide-label>
      {props.options.map((o) => (
        <slab-option key={o.value} value={o.value} title={o.label}>
          {o.label}
        </slab-option>
      ))}
    </slab-listbox>
  );
}

export function Checkbox(props: { label: string; checked: boolean; onChecked(checked: boolean): void; hideLabel?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useProperty(ref, "checked", props.checked);
  useEvent(ref, "change", (el) => props.onChecked(Boolean(el.checked)));
  return <slab-checkbox ref={ref} label={props.label} hide-label={props.hideLabel || undefined} />;
}

export function ToggleGroup(props: { label: string; value: string; options: Choice[]; onValue(value: string): void; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  // The group has no change event; buttons report presses through clicks.
  useEvent(
    ref,
    "click",
    (el) => {
      const value = String(el.value ?? "");
      if (value && value !== props.value) props.onValue(value);
    },
    { fromChildren: true },
  );
  return (
    <slab-toggle-group ref={ref} label={props.label} class={`segmented${props.className ? ` ${props.className}` : ""}`}>
      {props.options.map((o) => (
        <slab-toggle-group-button
          key={o.value}
          value={o.value}
          pressed={o.value === props.value}
          label={o.content ? o.label : undefined}
          title={o.content ? o.label : undefined}
        >
          {o.content ?? o.label}
        </slab-toggle-group-button>
      ))}
    </slab-toggle-group>
  );
}

// ---------------------------------------------------------------- structure

export interface TabSpec {
  id: string;
  label: ReactNode;
}

/** Tabs with their panels. Panels are passed as `<TabPanel name>` children. */
export function Tabs(props: { label: string; value: string; tabs: TabSpec[]; onValue(id: string): void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  // Slab owns selection after the first render; re-setting `selected` each render makes Lit re-update.
  const [initial] = useState(props.value);
  useEvent(ref, "change", (el) => {
    const tab = el.selectedTab as (HTMLElement & { panel?: string }) | null;
    if (tab?.panel) props.onValue(tab.panel);
  });
  return (
    <slab-tabs ref={ref} label={props.label} class={props.className}>
      {props.tabs.map((t) => (
        <slab-tabs-tab key={t.id} slot="tab" panel={t.id} selected={t.id === initial || undefined}>
          {t.label}
        </slab-tabs-tab>
      ))}
      {props.children}
    </slab-tabs>
  );
}

export function TabPanel({ name, children, className }: { name: string; children: ReactNode; className?: string }) {
  return (
    <slab-tabs-panel name={name} class={className}>
      {children}
    </slab-tabs-panel>
  );
}

export function Toolbar({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <slab-toolbar label={label} class={className}>
      {children}
    </slab-toolbar>
  );
}

/** Matches Slab's default `close-delay`. */
const TOOLTIP_CLOSE_MS = 200;

export function Tooltip({ label, children, placement = "bottom" }: { label: string; children: ReactNode; placement?: "top" | "bottom" | "left" | "right" }) {
  const ref = useRef<HTMLElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const keyboardFocused = (el: Writable) => Boolean((el as unknown as HTMLElement).querySelector(":focus-visible"));
  // Slab keeps a tooltip open while its anchor has focus, so a clicked button's
  // tooltip would never hide. Only keyboard focus (:focus-visible) keeps it open.
  useEvent(
    ref,
    "focusin",
    (el) => {
      if (!keyboardFocused(el)) el.open = false;
    },
    { fromChildren: true },
  );
  useEvent(
    ref,
    "pointerdown",
    (el) => {
      el.open = false;
    },
    { fromChildren: true },
  );
  useEvent(ref, "mouseenter", () => window.clearTimeout(closeTimer.current));
  useEvent(ref, "mouseleave", (el) => {
    if (!el.open || keyboardFocused(el)) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => (el.open = false), TOOLTIP_CLOSE_MS);
  });
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  return (
    <slab-tooltip ref={ref} placement={placement}>
      <span slot="anchor">{children}</span>
      {/* Slab requires an element, not bare text, in the default slot. */}
      <span>{label}</span>
    </slab-tooltip>
  );
}

/** A menu button. `anchor` is the button that opens it; items are `<MenuItem>` children, and Slab requires at least one. */
export function Menu(props: { label: string; anchor: ReactNode; children: ReactNode; placement?: "top" | "bottom" | "left" | "right"; className?: string }) {
  return (
    <slab-menu label={props.label} placement={props.placement} class={props.className}>
      <span slot="anchor">{props.anchor}</span>
      {props.children}
    </slab-menu>
  );
}

export function MenuItem(props: { children: ReactNode; onSelect(): void; label?: string; disabled?: boolean; className?: string }) {
  return (
    <slab-menu-item label={props.label} disabled={props.disabled || undefined} class={props.className} onClick={props.onSelect}>
      {props.children}
    </slab-menu-item>
  );
}

export interface TreeNode {
  /** Unique within the tree; reported by `onSelect` for leaves. */
  id: string;
  label: string;
  content?: ReactNode;
  children?: TreeNode[];
  expanded?: boolean;
}

/** A tree that reports leaf selections. Selecting a parent only expands it. */
export function Tree(props: { label: string; nodes: TreeNode[]; value: string | null; onSelect(id: string): void; className?: string }) {
  // Slab requires at least one Tree Item, so an empty tree renders nothing.
  if (props.nodes.length === 0) return <div className={props.className} />;
  return <TreeInner {...props} />;
}

function TreeInner(props: { label: string; nodes: TreeNode[]; value: string | null; onSelect(id: string): void; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEvent(ref, "change", (el) => {
    const item = el.selectedItem as HTMLElement | null;
    const id = item?.dataset.leaf;
    if (id) props.onSelect(id);
  });
  const render = (n: TreeNode): ReactNode => (
    <slab-tree-item
      key={n.id}
      label={n.label}
      data-leaf={n.children ? undefined : n.id}
      expanded={n.expanded || undefined}
      selected={(!n.children && n.id === props.value) || undefined}
    >
      {n.content ?? n.label}
      {n.children?.map(render)}
    </slab-tree-item>
  );
  return (
    <slab-tree ref={ref} label={props.label} class={props.className}>
      {props.nodes.map(render)}
    </slab-tree>
  );
}

export function Disclosure(props: { label: string; open?: boolean; children: ReactNode; className?: string }) {
  return (
    <slab-disclosure label={props.label} open={props.open || undefined} class={props.className}>
      {props.children}
    </slab-disclosure>
  );
}

// ---------------------------------------------------------------- feedback

export type Tone = "info" | "warning" | "danger" | "success";

export function Alert({ tone = "info", children, onDismiss }: { tone?: Tone; children: ReactNode; onDismiss?(): void }) {
  const ref = useRef<HTMLElement>(null);
  useEvent(ref, "dismiss", () => onDismiss?.());
  return (
    <slab-alert ref={ref} class={`tone-${tone}`} dismissible={onDismiss ? true : undefined} dismiss-label="Dismiss">
      {children}
    </slab-alert>
  );
}

export function Pagination(props: { label: string; page: number; total: number; onPage(page: number): void; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useProperty(ref, "total", props.total);
  useProperty(ref, "page", props.page);
  useEvent(ref, "change", (el) => props.onPage(Number(el.page)));
  return <slab-pagination ref={ref} label={props.label} class={props.className} />;
}

export function Progress({ label, className }: { label: string; className?: string }) {
  return <slab-progress label={label} hide-label class={className} />;
}

export function Dialog(props: { open: boolean; label: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useProperty(ref, "open", props.open);
  useEvent(ref, "close", () => props.onClose());
  return (
    <slab-dialog ref={ref} label={props.label} closedby="any">
      {props.children}
    </slab-dialog>
  );
}

/** Asks for confirmation in a Slab dialog. Resolves true when confirmed. */
export function useConfirm(): [ReactNode, (opts: { title: string; body: string; confirmLabel: string; danger?: boolean }) => Promise<boolean>] {
  const [state, setState] = useState<{ title: string; body: string; confirmLabel: string; danger?: boolean; resolve(v: boolean): void } | null>(null);
  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };
  const node = (
    <Dialog open={state !== null} label={state?.title ?? ""} onClose={() => close(false)}>
      <p>{state?.body}</p>
      <div className="row actions">
        <button onClick={() => close(false)}>Cancel</button>
        <button className={state?.danger ? "danger solid" : "primary"} onClick={() => close(true)}>
          {state?.confirmLabel}
        </button>
      </div>
    </Dialog>
  );
  return [node, (opts) => new Promise<boolean>((resolve) => setState({ ...opts, resolve }))];
}

// A single live region for the whole app; Slab toasts are shown, not mounted on demand.
let showToast: ((message: string, tone: Tone) => void) | null = null;

export function toast(message: string, tone: Tone = "info"): void {
  showToast?.(message, tone);
}

export function ToastHost() {
  const ref = useRef<HTMLElement>(null);
  const [content, setContent] = useState<{ message: string; tone: Tone }>({ message: "", tone: "info" });
  useEffect(() => {
    showToast = (message, tone) => {
      setContent({ message, tone });
      // Let React render the new content before the region announces it.
      requestAnimationFrame(() => void (ref.current as unknown as { show(): Promise<void> } | null)?.show());
    };
    return () => {
      showToast = null;
    };
  }, []);
  return (
    <slab-toast ref={ref} class={`tone-${content.tone}`} duration={4000}>
      {content.message}
    </slab-toast>
  );
}
