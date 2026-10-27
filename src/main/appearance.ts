// Main-side appearance effects (PRD §4 F7): native theme, and the window's glass for every window. The shell is
// fixed: native vibrancy behind a transparent window, tinted per theme by the renderer (--glass-shell).
import { app, nativeTheme, type BrowserWindow } from 'electron'
import { resolveTheme, windowBackgroundColor } from '@shared/appearance'
import type { AppSettings } from '@shared/settings'
import { allAppWindows, isAppWindow } from './app-windows'
import { getSettings, onSettingsChange } from './settings'

function applyToWindow(win: BrowserWindow, settings: AppSettings): void {
  if (win.isDestroyed()) return
  const glass = process.platform === 'darwin'
  const resolved = resolveTheme(settings.appearance.theme, nativeTheme.shouldUseDarkColors)
  win.setBackgroundColor(windowBackgroundColor(resolved, glass))
  if (glass) win.setVibrancy('sidebar')
}

function applyToAll(settings: AppSettings): void {
  // Forces the native appearance (and prefers-color-scheme in renderers) to the user's choice.
  nativeTheme.themeSource = settings.appearance.theme
  for (const win of allAppWindows()) applyToWindow(win, settings)
}

export function registerAppearanceEffects(): void {
  nativeTheme.themeSource = getSettings().appearance.theme
  // Windows are created hidden (shown on ready-to-show), so this lands before first paint.
  app.on('browser-window-created', (_event, win) => {
    if (isAppWindow(win)) applyToWindow(win, getSettings())
  })
  onSettingsChange(applyToAll)
  // 'system' resolves differently when the OS flips; keep the native fill in step.
  nativeTheme.on('updated', () => applyToAll(getSettings()))
}
