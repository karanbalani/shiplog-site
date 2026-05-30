import { describe, expect, test } from "bun:test";
import {
  getThemeModeParts,
  getNextThemeMode,
  readStoredThemeMode,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "./site-theme";

describe("site theme", () => {
  test("cycles system, light, and dark modes", () => {
    expect(getNextThemeMode("system")).toBe("light");
    expect(getNextThemeMode("light")).toBe("dark");
    expect(getNextThemeMode("dark")).toBe("system");
  });

  test("splits theme labels into a collapsed mark and hover suffix", () => {
    expect(getThemeModeParts("system")).toEqual({ mark: "S", suffix: "ystem" });
    expect(getThemeModeParts("light")).toEqual({ mark: "L", suffix: "ight" });
    expect(getThemeModeParts("dark")).toEqual({ mark: "D", suffix: "ark" });
  });

  test("resolves system mode from the user's color preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  test("reads the shared theme mode before legacy landing storage", () => {
    const shared = new Map([
      [THEME_STORAGE_KEY, "dark"],
      ["shiplog-landing-theme", "light"],
    ]);

    expect(readStoredThemeMode((key) => shared.get(key) ?? null)).toBe("dark");
  });

  test("falls back to legacy landing theme storage", () => {
    const legacy = new Map([["shiplog-landing-theme", "light"]]);

    expect(readStoredThemeMode((key) => legacy.get(key) ?? null)).toBe("light");
  });

  test("ignores invalid stored modes", () => {
    const invalid = new Map([[THEME_STORAGE_KEY, "sepia"]]);

    expect(readStoredThemeMode((key) => invalid.get(key) ?? null)).toBe("system");
  });
});
