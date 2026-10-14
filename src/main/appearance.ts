// Main-side appearance effects (docs/tasks/m3-appearance-runtime.md): native theme, window
// background color (no flash of the wrong color) and sidebar vibrancy for every window.
import { app, BrowserWindow, nativeTheme } from 'electron'
import { resolveTheme, windowBackgroundColor } from '@shared/appearance'
import type { AppSettings } from '@shared/settings'
import { getSettings, onSettingsChange } from './settings'

function applyToWindow(win: BrowserWindow, settings: AppSettings): void {
  if (win.isDestroyed()) return
  const { theme, sidebarVibrancy } = settings.appearance
  const resolved = resolveTheme(theme, nativeTheme.shouldUseDarkColors)
  win.setBackgroundColor(windowBackgroundColor(resolved, sidebarVibrancy))
  if (process.platform === 'darwin') win.setVibrancy(sidebarVibrancy ? 'sidebar' : null)
}

function applyToAll(settings: AppSettings): void {
  // Forces the native appearance (and prefers-color-scheme in renderers) to the user's choice.
  nativeTheme.themeSource = settings.appearance.theme
  for (const win of BrowserWindow.getAllWindows()) applyToWindow(win, settings)
}

export function registerAppearanceEffects(): void {
  nativeTheme.themeSource = getSettings().appearance.theme
  // Windows are created hidden (shown on ready-to-show), so this lands before first paint.
  app.on('browser-window-created', (_event, win) => applyToWindow(win, getSettings()))
  onSettingsChange(applyToAll)
  // 'system' resolves differently when the OS flips; keep the native fill in step.
  nativeTheme.on('updated', () => applyToAll(getSettings()))
}
