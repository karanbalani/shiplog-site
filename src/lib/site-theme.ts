export const THEME_STORAGE_KEY = "shiplog-theme";
export const LEGACY_THEME_STORAGE_KEY = "shiplog-landing-theme";
export const THEME_MODES = ["system", "light", "dark"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];
export type ResolvedTheme = Exclude<ThemeMode, "system">;

type StorageReader = (key: string) => string | null;

export const isThemeMode = (mode: string | null | undefined): mode is ThemeMode =>
  THEME_MODES.includes(mode as ThemeMode);

export const getNextThemeMode = (mode: ThemeMode): ThemeMode =>
  THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length];

export const resolveTheme = (mode: ThemeMode, prefersDark: boolean): ResolvedTheme => {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
};

export const readStoredThemeMode = (getItem: StorageReader): ThemeMode => {
  const mode = getItem(THEME_STORAGE_KEY) ?? getItem(LEGACY_THEME_STORAGE_KEY);
  return isThemeMode(mode) ? mode : "system";
};

const getThemeModeLabel = (mode: ThemeMode) => mode[0].toUpperCase() + mode.slice(1);

const safeStorageRead = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeStorageWrite = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore restricted storage contexts. The active page can still update.
  }
};

export const initSiteThemeToggle = () => {
  const root = document.documentElement;
  const toggle = document.querySelector("[data-theme-toggle]");
  const mark = document.querySelector("[data-theme-mark]");
  const label = document.querySelector("[data-theme-label]");
  const systemPreference = window.matchMedia("(prefers-color-scheme: dark)");

  const setThemeMode = (mode: ThemeMode) => {
    const nextMode = getNextThemeMode(mode);
    const modeLabel = getThemeModeLabel(mode);

    root.dataset.themeMode = mode;
    root.dataset.theme = resolveTheme(mode, systemPreference.matches);
    toggle?.setAttribute("aria-label", `Theme: ${mode}. Click for ${nextMode} theme.`);

    if (mark instanceof HTMLElement) {
      mark.textContent = modeLabel[0];
    }

    if (label instanceof HTMLElement) {
      label.textContent = modeLabel;
    }
  };

  setThemeMode(
    isThemeMode(root.dataset.themeMode)
      ? root.dataset.themeMode
      : readStoredThemeMode(safeStorageRead),
  );

  toggle?.addEventListener("click", () => {
    const mode = isThemeMode(root.dataset.themeMode)
      ? getNextThemeMode(root.dataset.themeMode)
      : "system";

    safeStorageWrite(THEME_STORAGE_KEY, mode);
    setThemeMode(mode);
  });

  systemPreference.addEventListener("change", () => {
    if (root.dataset.themeMode === "system") {
      setThemeMode("system");
    }
  });
};
