// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  THEME_STORAGE_KEY,
  applyThemeMode,
  nextThemeMode,
  normalizeThemeMode,
  readThemePreference,
  writeThemePreference,
} from "./themePrefs";

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  vi.restoreAllMocks();
});

describe("normalizeThemeMode", () => {
  it("returns light only for exactly 'light'; everything else is dark", () => {
    expect(normalizeThemeMode("light")).toBe("light");
    expect(normalizeThemeMode("dark")).toBe("dark");
    expect(normalizeThemeMode(null)).toBe("dark");
    expect(normalizeThemeMode(undefined)).toBe("dark");
    expect(normalizeThemeMode("Light")).toBe("dark"); // case-sensitive by design
    expect(normalizeThemeMode("garbage")).toBe("dark");
    expect(normalizeThemeMode(123)).toBe("dark");
  });
});

describe("nextThemeMode", () => {
  it("toggles", () => {
    expect(nextThemeMode("dark")).toBe("light");
    expect(nextThemeMode("light")).toBe("dark");
  });
});

describe("persistence (local only)", () => {
  it("defaults to dark when nothing is stored", () => {
    expect(readThemePreference()).toBe("dark");
  });

  it("round-trips a written preference through localStorage", () => {
    writeThemePreference("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(readThemePreference()).toBe("light");
    writeThemePreference("dark");
    expect(readThemePreference()).toBe("dark");
  });

  it("normalizes garbage stored values to dark", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "neon");
    expect(readThemePreference()).toBe("dark");
  });

  it("survives localStorage throwing (best-effort, returns dark)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readThemePreference()).toBe("dark");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeThemePreference("light")).not.toThrow();
  });
});

describe("applyThemeMode", () => {
  it("sets data-theme and color-scheme on the root", () => {
    applyThemeMode("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    applyThemeMode("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("normalizes the applied data-theme value", () => {
    applyThemeMode("nonsense" as unknown as "dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("no-ops safely when given a null root", () => {
    expect(() => applyThemeMode("light", null)).not.toThrow();
  });
});
