/**
 * The chat composer used on the home page and in the workspace. Enter sends,
 * Shift+Enter adds a line, and the box grows with its content. It is a native
 * textarea rather than Slab's, because auto-growing needs the element's
 * scrollHeight, which sits behind Slab's shadow root.
 */
import { useEffect, useLayoutEffect, useRef, type MutableRefObject, type ReactNode } from "react";
import { Icon } from "../ui/icons";

const MAX_HEIGHT = 240;

export default function PromptBox(props: {
  value: string;
  onValue(value: string): void;
  onSubmit(): void;
  onStop?(): void;
  /** True while a reply is streaming: the send button becomes a stop button. */
  busy?: boolean;
  label: string;
  placeholder: string;
  footer?: ReactNode;
  autoFocus?: boolean;
  /** Receives a function that focuses the textarea. */
  focusRef?: MutableRefObject<(() => void) | undefined>;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [props.value]);

  useEffect(() => {
    if (props.focusRef) {
      props.focusRef.current = () => {
        const el = ref.current;
        el?.focus();
        el?.setSelectionRange(el.value.length, el.value.length);
      };
    }
    if (props.autoFocus) ref.current?.focus();
  }, [props.focusRef, props.autoFocus]);

  const canSend = props.value.trim().length > 0 && !props.busy;

  return (
    <div className="prompt-box" onClick={(e) => e.target === e.currentTarget && ref.current?.focus()}>
      <textarea
        ref={ref}
        aria-label={props.label}
        placeholder={props.placeholder}
        rows={2}
        value={props.value}
        onChange={(e) => props.onValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) props.onSubmit();
          }
        }}
      />
      <div className="prompt-foot">
        {props.footer}
        <div className="spacer" />
        <span className="prompt-hint muted small">⇧↵ new line</span>
        {props.busy && props.onStop ? (
          <button className="send-btn stop" aria-label="Stop generating" title="Stop" onClick={props.onStop}>
            <Icon name="stop" size={14} />
          </button>
        ) : (
          <button className="send-btn" aria-label="Send" title="Send (↵)" disabled={!canSend} onClick={props.onSubmit}>
            {props.busy ? <span className="spinner light" aria-hidden="true" /> : <Icon name="arrowUp" size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}
