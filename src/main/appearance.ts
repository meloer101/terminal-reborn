// Main-side appearance effects (PRD §4 F7): native theme, and the window's glass for every window. The shell is
// fixed: on macOS 26 Liquid Glass (NSGlassEffectView) under a transparent window, untinted (PRD §5 v1.95); before
// that, native vibrancy tinted per theme by the renderer (--glass-shell).
import { app, nativeTheme, type BrowserWindow } from 'electron'
import liquidGlass from 'electron-liquid-glass'
import { resolveTheme, windowBackgroundColor } from '@shared/appearance'
import type { AppSettings } from '@shared/settings'
import { allAppWindows, isAppWindow } from './app-windows'
import { getSettings, onSettingsChange } from './settings'

/**
 * macOS 26's Liquid Glass under the whole window (electron-liquid-glass puts one NSGlassEffectView behind the web
 * contents). It needs a transparent window (windows.ts) and no vibrancy, and it must not be tinted over: the tint is
 * what made the old shell read as grey frosted glass. The version comes from Electron: the library's own
 * `isGlassSupported()` runs `sw_vers` synchronously, on the startup path.
 */
export const nativeGlass = process.platform === 'darwin' && Number(process.getSystemVersion().split('.')[0]) >= 26
/** The glass's corner, the same as the window's on macOS 26. */
const GLASS_RADIUS = 16
const glassed = new WeakSet<BrowserWindow>()
// The renderer tints the vibrancy shell with --glass-shell; on Liquid Glass that tint goes (every load, reloads too).
const NO_TINT = ':root, :root[data-theme] { --glass-shell: transparent !important; }'

function attachGlass(win: BrowserWindow): void {
  if (glassed.has(win)) return
  glassed.add(win)
  // The glass goes on before the window is first shown, so its first frame already has it: the boot screen (PRD F18)
  // shows the window before the page has finished loading, and until the glass is there the transparent window is black.
  // A glass view added while the window is hidden is not drawn until something redraws the window (the author saw the
  // shell stay opaque until switching the theme), so the transparent fill is set again once it is on screen.
  // -1: the native addon did not load (it logs why). The window is transparent already, so it gets the vibrancy shell,
  // tint included, rather than no glass at all.
  if (liquidGlass.addView(win.getNativeWindowHandle(), { cornerRadius: GLASS_RADIUS }) < 0) {
    win.setVibrancy('sidebar')
    return
  }
  const apply = (): void => {
    if (win.isDestroyed()) return
    void win.webContents.insertCSS(NO_TINT)
  }
  win.webContents.on('did-finish-load', apply)
  const redraw = (): void => {
    if (!win.isDestroyed()) win.setBackgroundColor('#00000000')
  }
  if (win.isVisible()) redraw()
  else win.once('show', redraw)
}

function applyToWindow(win: BrowserWindow, settings: AppSettings): void {
  if (win.isDestroyed()) return
  const glass = process.platform === 'darwin'
  const resolved = resolveTheme(settings.appearance.theme, nativeTheme.shouldUseDarkColors)
  win.setBackgroundColor(windowBackgroundColor(resolved, glass))
  if (nativeGlass) attachGlass(win)
  else if (glass) win.setVibrancy('sidebar')
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
