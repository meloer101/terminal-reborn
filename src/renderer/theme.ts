export type ThemePreference = 'system' | 'dark' | 'light'

const STORAGE_KEY = 'tr.theme.v1'
const query = window.matchMedia('(prefers-color-scheme: light)')

let current: ThemePreference = 'system'

function render(): void {
  const resolved = current === 'system' ? (query.matches ? 'light' : 'dark') : current
  document.documentElement.dataset.theme = resolved
}

// One listener for the app's lifetime; it only matters while the preference is 'system'.
query.addEventListener('change', () => {
  if (current === 'system') render()
})

/**
 * Applies and remembers the theme preference (<html data-theme>). A manual dark/light choice
 * is not overridden by later OS appearance changes. The returned disposer is a no-op kept for
 * callers that manage their own lifecycles.
 */
export function applyTheme(preference: ThemePreference): () => void {
  current = preference
  render()
  try {
    localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Storage unavailable: the choice lasts for this run.
  }
  return () => {}
}

/** Restores the saved preference at startup (defaults to following the system). */
export function initTheme(): void {
  let saved: string | null = null
  try {
    saved = localStorage.getItem(STORAGE_KEY)
  } catch {
    // Fall through to the default.
  }
  current = saved === 'dark' || saved === 'light' ? saved : 'system'
  render()
}
