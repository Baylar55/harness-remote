import { normalizeLanguage, type LanguageCode } from "./i18n"

/**
 * Appearance and language are one product preference, not one per shell. Classic 2.x already owned
 * these two keys, so TaskDesk reads and writes exactly the same storage instead of introducing a
 * second set that would silently disagree with Classic after a switch.
 */
export const LANGUAGE_STORAGE_KEY = "opencode.remote.language"
export const THEME_STORAGE_KEY = "opencode.remote.theme"

/** Fired after a preference is persisted so every mounted shell can follow without a reload. */
export const APP_PREFERENCES_CHANGED_EVENT = "harness-remote:preferences-changed"

export type ThemePreference = "system" | "light" | "dark"
export type ResolvedTheme = "light" | "dark"

export const themePreferences: ThemePreference[] = ["system", "light", "dark"]

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark"
}

export function loadThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(saved) ? saved : "system"
  } catch {
    return "system"
  }
}

export function loadLanguage(): LanguageCode {
  try {
    return normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY) || navigator.language)
  } catch {
    return "en"
  }
}

export function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "dark") return "dark"
  if (preference === "light") return "light"
  return prefersDark() ? "dark" : "light"
}

/**
 * The single place that writes the theme onto the document. `color-scheme` matters as much as the
 * data attribute: it is what makes native scrollbars, form controls and the canvas behind a
 * rubber-band scroll follow the chosen theme instead of staying light.
 */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference)
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolved
    document.documentElement.style.colorScheme = resolved
  }
  return resolved
}

export function persistThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    /* a private-mode browser still gets the applied theme for this session */
  }
  applyTheme(preference)
  notifyPreferencesChanged()
}

export function persistLanguage(language: LanguageCode): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    /* keep the in-memory choice */
  }
  if (typeof document !== "undefined") document.documentElement.lang = language
  notifyPreferencesChanged()
}

export function notifyPreferencesChanged(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(APP_PREFERENCES_CHANGED_EVENT))
}

/**
 * Called once at startup. Classic used to apply the theme from inside its own component tree, which
 * meant TaskDesk — the shell that now boots first — never applied one at all and stayed on the
 * stylesheet default regardless of the saved preference.
 */
export function installAppPreferences(): () => void {
  const preference = loadThemePreference()
  applyTheme(preference)
  if (typeof document !== "undefined") document.documentElement.lang = loadLanguage()

  if (typeof window === "undefined") return () => undefined
  const media = window.matchMedia("(prefers-color-scheme: dark)")
  const followSystem = () => {
    if (loadThemePreference() === "system") applyTheme("system")
  }
  media.addEventListener("change", followSystem)
  return () => media.removeEventListener("change", followSystem)
}
