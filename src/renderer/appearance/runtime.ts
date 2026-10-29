// Applies AppSettings.appearance to the running window: CSS variables for the terminal background layers, and the
// terminal appearance for every xterm surface. The window's glass is fixed (main/appearance.ts, AppShell).
// Theme (<html data-theme>) is handled by ../theme.ts, which every window runs.
import type { AppearanceSettings } from '@shared/settings'
import { markAppearanceKnown } from '../terminal/appearance-ready'
import { setTerminalAppearance } from '../terminal/registry'
import { toAppearanceDom, toTerminalAppearance } from './map'

let lastTerminal = ''

/** Idempotent: unchanged parts are skipped, so slider drags only touch what moved. */
export function applyAppearance(appearance: AppearanceSettings): void {
  const root = document.documentElement
  const dom = toAppearanceDom(appearance)
  for (const [name, value] of Object.entries(dom.vars)) {
    if (value === null) {
      if (root.style.getPropertyValue(name) !== '') root.style.removeProperty(name)
    } else if (root.style.getPropertyValue(name) !== value) {
      root.style.setProperty(name, value)
    }
  }
  for (const [name, value] of Object.entries(dom.attrs)) if (root.getAttribute(name) !== value) root.setAttribute(name, value)
  const terminal = toTerminalAppearance(appearance)
  const key = JSON.stringify(terminal)
  if (key !== lastTerminal) {
    lastTerminal = key
    setTerminalAppearance(terminal)
  }
}

/** Loads the current settings, applies them, and keeps applying changes. Returns the disposer. */
export function watchAppearance(): () => void {
  let live = true
  // A change that arrives before the initial get() resolves is newer than it.
  let changed = false
  const stop = window.tr.settings.onChange((settings) => {
    changed = true
    if (live) applyAppearance(settings.appearance)
    markAppearanceKnown()
  })
  void window.tr.settings
    .get()
    .then((settings) => {
      if (live && !changed) applyAppearance(settings.appearance)
    })
    .catch(() => {})
    .finally(markAppearanceKnown)
  return () => {
    live = false
    stop()
  }
}
