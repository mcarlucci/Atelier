/** A live copy of the app's preview that the chat can look at and use. Electron supplies it; tests supply a fake. */
export interface ConsoleEntry {
  level: "error" | "warning" | "info" | "log";
  text: string;
}

export interface PreviewPage {
  /** A JPEG of the page at this size. `fullPage` grows the height to the whole document (at most 4000px). */
  screenshot(opts: { width: number; height: number; fullPage: boolean }): Promise<Buffer>;
  /** Runs a script in the page and returns its JSON-serializable result. */
  evaluate<T>(script: string): Promise<T>;
  /** Console output and load failures since the page opened. */
  messages(): ConsoleEntry[];
  close(): void;
}

export type OpenPreview = (url: string) => Promise<PreviewPage>;
