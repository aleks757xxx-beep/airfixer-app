export type ThemeChoice = "system" | "light" | "dark";

const KEY = "pf-theme";

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

export function saveTheme(t: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* приватный режим — просто не запоминаем */
  }
}

export function applyTheme(t: ThemeChoice): void {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
