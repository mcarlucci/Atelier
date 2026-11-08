import type { PreviewCheck } from "@shared/types";
import type { ConsoleEntry, PreviewPage } from "./page";

/** What the page looks like to a visitor, read in the page. */
export interface PageSnapshot {
  /** Characters of visible text. */
  text: number;
  /** Images, SVG, canvas, video and form controls: a page can be real without any text. */
  media: number;
  /** The Vite error overlay's text, when the dev server is showing one. */
  overlay: string | null;
}

export const SNAPSHOT_SCRIPT = `(() => {
  const overlay = document.querySelector("vite-error-overlay");
  return {
    text: (document.body ? document.body.innerText : "").trim().length,
    media: document.querySelectorAll("img, svg, canvas, video, input, select, textarea").length,
    overlay: overlay && overlay.shadowRoot ? overlay.shadowRoot.textContent.trim().slice(0, 600) : null,
  };
})()`;

const NOISE = /favicon\.ico|React DevTools|\[vite\] (connecting|connected)|ResizeObserver loop/i;

/** Decides whether the preview is healthy. Pure, so it can be tested without a browser. */
export function classifyPreview(snapshot: PageSnapshot, messages: readonly ConsoleEntry[]): PreviewCheck {
  const errors = [...new Set(messages.filter((m) => m.level === "error" && !NOISE.test(m.text)).map((m) => m.text.trim().slice(0, 300)))].slice(0, 5);
  if (snapshot.overlay) errors.unshift(`Build error: ${snapshot.overlay.replace(/\s+/g, " ").slice(0, 300)}`);
  const blank = snapshot.text === 0 && snapshot.media === 0;
  return { ok: !blank && errors.length === 0, blank, errors: errors.slice(0, 5) };
}

/** Loads the page fresh and reports on it. */
export async function checkPreviewPage(page: PreviewPage): Promise<PreviewCheck> {
  const snapshot = await page.evaluate<PageSnapshot>(SNAPSHOT_SCRIPT);
  return classifyPreview(snapshot, page.messages());
}
