/** Number of stages `importStage` can report. */
export const IMPORT_STAGES = 4;

/** Maps a raw import log line to a plain-language stage (n of IMPORT_STAGES) and one sentence on why it matters. */
export function importStage(line: string): { n: number; title: string; why: string } {
  if (line.startsWith("[compile]")) return { n: 3, title: "Building the contract", why: "Invariant UI turns your components into rules the AI must follow." };
  if (/declaration file|Found \d+ .* components/i.test(line)) return { n: 2, title: "Reading components", why: "Atelier learns every component and prop your package exports." };
  if (/Playwright|Chromium/i.test(line)) return { n: 4, title: "Setting up browser checks", why: "Checks run in a real browser to confirm screens render." };
  return { n: 1, title: "Downloading the package", why: "Atelier installs it in a private folder, so your projects stay untouched." };
}
