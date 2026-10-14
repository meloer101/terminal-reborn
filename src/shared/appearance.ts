// Pure appearance helpers shared by main (window chrome) and the renderer (theme resolution).
import type { ThemePreference } from './settings'

export type ResolvedTheme = 'dark' | 'light'

/** Window background per resolved theme; must equal `--bg-app` in tokens.css so there is no flash. */
export const WINDOW_BACKGROUND: Record<ResolvedTheme, string> = {
  dark: '#0a0a0a',
  light: '#ffffff'
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}

/**
 * Native window background. With vibrancy on it must be transparent, otherwise the opaque window
 * fill hides the blur behind the sidebar.
 */
export function windowBackgroundColor(theme: ResolvedTheme, vibrancy: boolean): string {
  return vibrancy ? '#00000000' : WINDOW_BACKGROUND[theme]
}
