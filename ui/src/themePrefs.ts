export type ThemeMode = "dark" | "light";

export const THEME_STORAGE_KEY = "caesura.theme.v1";

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" ? "light" : "dark";
}

export function readThemePreference(): ThemeMode {
  try {
    if (typeof window === "undefined") return "dark";
    return normalizeThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "dark";
  }
}

export function writeThemePreference(mode: ThemeMode) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Best-effort display preference.
  }
}

export function applyThemeMode(
  mode: ThemeMode,
  root: HTMLElement | null =
    typeof document === "undefined" ? null : document.documentElement
) {
  if (!root) return;
  root.dataset.theme = normalizeThemeMode(mode);
  root.style.colorScheme = mode;
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return mode === "dark" ? "light" : "dark";
}
