export type ThemePreference = 'system' | 'dark' | 'light'

const query = window.matchMedia('(prefers-color-scheme: light)')

/** Applies the theme to <html data-theme>; returns a disposer for the system listener. */
export function applyTheme(preference: ThemePreference): () => void {
  const apply = () => {
    const resolved = preference === 'system' ? (query.matches ? 'light' : 'dark') : preference
    document.documentElement.dataset.theme = resolved
  }
  apply()
  if (preference !== 'system') return () => {}
  query.addEventListener('change', apply)
  return () => query.removeEventListener('change', apply)
}
