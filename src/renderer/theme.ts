// Theme preference → <html data-theme>. The source of truth is AppSettings.appearance.theme (shared by
// every window through window.tr.settings); localStorage only mirrors it so the next launch can set
// data-theme synchronously, before the first paint and before the async settings read returns.
import { resolveTheme } from '@shared/appearance'
import type { ThemePreference } from '@shared/settings'

export type { ThemePreference }

const BOOT_KEY = 'tr.theme.boot'
/** The pre-settings storage key; migrated into settings once, then removed. */
const LEGACY_KEY = 'tr.theme.v1'
const query = window.matchMedia('(prefers-color-scheme: light)')

let current: ThemePreference = 'system'

function render(): void {
  document.documentElement.dataset.theme = resolveTheme(current, !query.matches)
}

// One listener for the app's lifetime; it only matters while the preference is 'system'.
query.addEventListener('change', () => {
  if (current === 'system') render()
})

function isPreference(value: unknown): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system'
}

function remember(preference: ThemePreference): void {
  try {
    localStorage.setItem(BOOT_KEY, preference)
  } catch {
    // Storage unavailable: first paint may use the system theme for one frame.
  }
}

function set(preference: ThemePreference): void {
  current = preference
  render()
  remember(preference)
}

/**
 * Applies a theme preference immediately and persists it through settings (which then reaches every
 * window). A manual dark/light choice is not overridden by later OS appearance changes. The returned
 * disposer is a no-op kept for callers that manage their own lifecycles.
 */
export function applyTheme(preference: ThemePreference): () => void {
  set(preference)
  void window.tr.settings.update({ appearance: { theme: preference } }).catch(() => {})
  return () => {}
}

/** Moves a value saved by the old localStorage-only implementation into settings, once. */
function migrateLegacy(settingsTheme: ThemePreference): void {
  let legacy: string | null
  try {
    legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy !== null) localStorage.removeItem(LEGACY_KEY)
  } catch {
    return
  }
  // Only an explicit old choice counts, and never over a theme already chosen in settings.
  if ((legacy === 'dark' || legacy === 'light') && settingsTheme === 'system') {
    set(legacy)
    void window.tr.settings.update({ appearance: { theme: legacy } }).catch(() => {})
  }
}

/** Sets the theme synchronously from the boot mirror, then follows settings (and their changes). */
export function initTheme(): void {
  let boot: string | null = null
  try {
    boot = localStorage.getItem(BOOT_KEY) ?? localStorage.getItem(LEGACY_KEY)
  } catch {
    // Fall through to the default.
  }
  current = isPreference(boot) ? boot : 'system'
  render()

  window.tr.settings.onChange((settings) => set(settings.appearance.theme))
  void window.tr.settings
    .get()
    .then((settings) => {
      set(settings.appearance.theme)
      migrateLegacy(settings.appearance.theme)
    })
    .catch(() => {})
}
