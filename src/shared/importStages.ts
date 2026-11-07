/** Maps a raw import log line to a plain-language stage and one sentence on why it matters. */
export function importStage(line: string): { title: string; why: string } {
  if (line.startsWith("[compile]")) return { title: "Building the contract", why: "Invariant UI turns your components into rules the AI must follow." };
  if (/declaration file|Found \d+ .* components/i.test(line)) return { title: "Reading components", why: "Atelier learns every component and prop your package exports." };
  if (/Playwright|Chromium/i.test(line)) return { title: "Setting up browser checks", why: "Checks run in a real browser to confirm screens render." };
  return { title: "Downloading the package", why: "Atelier installs it in a private folder, so your projects stay untouched." };
}
