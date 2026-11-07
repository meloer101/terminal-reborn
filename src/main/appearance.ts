// Main-side appearance effects (PRD §4 F7): native theme, and the window's glass for every window. On macOS 26 the
// window is transparent over Liquid Glass (NSGlassEffectView); 窗口 · 材质 「磨砂玻璃」 lays native vibrancy over it
// (PRD §5 v1.127: `setVibrancy('sidebar')` covers the glass, `setVibrancy(null)` shows it again — measured, no window
// to recreate). Before macOS 26 the shell is always vibrancy. The renderer tints either with --glass-shell at the
// user's 窗口底层不透明度 (appearance/map.ts). 「实色」 (v1.139) takes the vibrancy path too, covering the Liquid Glass (which
// cannot be removed); the renderer paints the shell opaque over it, which keeps the window's rounded corners.
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
/** Windows whose glass did not load: they keep the vibrancy shell whatever the material. */
const unglassed = new WeakSet<BrowserWindow>()
/** The vibrancy each window has, so a settings change elsewhere does not touch its native views. */
const vibrancy = new WeakMap<BrowserWindow, 'sidebar' | null>()

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
    unglassed.add(win)
    return
  }
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
  if (!glass) return
  if (nativeGlass) attachGlass(win)
  const liquid = nativeGlass && !unglassed.has(win) && settings.appearance.windowMaterial === 'liquid'
  const next = liquid ? null : 'sidebar'
  if (vibrancy.has(win) && vibrancy.get(win) === next) return
  vibrancy.set(win, next)
  win.setVibrancy(next)
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
