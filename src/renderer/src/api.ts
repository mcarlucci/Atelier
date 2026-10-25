export const api = window.atelier;

export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Electron prefixes errors thrown in ipcMain handlers.
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
