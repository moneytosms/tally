// Theme is a device preference, not account state - it lives in localStorage and
// never syncs. Kept free of React so index.html can apply it before first paint.
export type Theme = "system" | "paper" | "sakura" | "ocean" | "dark" | "midnight" | "ember";

/** Grouped light-then-dark, which is the order the picker renders them in. */
export const LIGHT_THEMES: Theme[] = ["paper", "sakura", "ocean"];
export const DARK_THEMES: Theme[] = ["dark", "midnight", "ember"];

export const THEMES: Theme[] = ["system", ...LIGHT_THEMES, ...DARK_THEMES];

const KEY = "tally-theme";

export function applyTheme(theme: Theme): void {
  // "system" carries no attribute, so the prefers-color-scheme block in
  // tokens.css is what resolves it.
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);

  // PWA chrome follows the ground colour. Read it back rather than duplicating
  // the hexes here.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--paper").trim());
}

export function getTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  return THEMES.includes(stored as Theme) ? (stored as Theme) : "system";
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}
