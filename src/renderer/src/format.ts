/** Formatting and preference helpers shared by the pages. */
import { useSyncExternalStore } from "react";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.round((timestamp - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

const LEADING_FILLER = new Set(["a", "an", "the", "build", "create", "make", "me", "design", "please", "i", "want", "need", "to", "for", "with", "simple", "new"]);

/** A short app name from a first prompt, e.g. "Build a todo app with tags" -> "Todo App". */
export function nameFromPrompt(prompt: string): string {
  const words = prompt.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean);
  while (words.length > 1 && LEADING_FILLER.has(words[0].toLowerCase())) words.shift();
  const stop = words.findIndex((w, i) => i > 0 && ["with", "that", "for", "where", "and", "which"].includes(w.toLowerCase()));
  const picked = words.slice(0, stop > 0 ? Math.min(stop, 4) : 4);
  const name = picked.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ").slice(0, 40).trim();
  return name || "Untitled app";
}

/** Stable hue for an app's avatar, so each app keeps its color. */
export function hueFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "A";
}

export type ThemePreference = "light" | "dark" | "system";
const THEME_KEY = "atelier.theme";

export function getThemePreference(): ThemePreference {
  const v = localStorage.getItem(THEME_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function applyTheme(pref: ThemePreference = getThemePreference()): void {
  localStorage.setItem(THEME_KEY, pref);
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  window.dispatchEvent(new Event("atelier-theme"));
}

const subscribeTheme = (onChange: () => void) => {
  window.addEventListener("atelier-theme", onChange);
  return () => window.removeEventListener("atelier-theme", onChange);
};

/** The saved theme preference, kept in sync wherever it's changed. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeTheme, getThemePreference);
}

/** A number kept in localStorage, for pane sizes and similar UI state. */
export function storedNumber(key: string, fallback: number): number {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** "claude-opus-5-5" -> "Claude Opus 5.5"; other ids are shown as they are. */
export function modelLabel(id: string): string {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id);
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  return id;
}

/** For tight spaces: drops "Claude" and an "org/" prefix such as OpenRouter's. */
export function shortModelLabel(id: string): string {
  return modelLabel(id).replace(/^Claude /, "").replace(/^[^/]+\//, "");
}
