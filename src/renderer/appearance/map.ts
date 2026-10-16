// Pure mapping from AppearanceSettings to what the renderer needs: xterm options, CSS variables
// for the terminal layers and <html> data attributes. No DOM access, so it is unit tested.
// The terminal color itself always comes from the theme (--term-bg): white in light mode, near-black in dark.
import type { AppearanceSettings } from '@shared/settings'
import type { TerminalAppearance } from '../terminal/surface'

/** Alpha of the terminal's default cell background: the user's terminal opacity over the theme color. */
export function terminalBackgroundAlpha(a: Pick<AppearanceSettings, 'terminalOpacity'>): number {
  return a.terminalOpacity
}

/** True when xterm needs `allowTransparency` (it costs subpixel text AA and WebGL, so only then). */
export function needsTransparency(a: Pick<AppearanceSettings, 'terminalOpacity'>): boolean {
  return terminalBackgroundAlpha(a) < 1
}

export function toTerminalAppearance(a: AppearanceSettings): TerminalAppearance {
  return {
    fontFamily: a.latinFont,
    cjkFontFamily: a.cjkFont,
    fontSize: a.fontSize,
    lineHeight: a.lineHeight,
    ligatures: a.ligatures,
    backgroundAlpha: terminalBackgroundAlpha(a)
  }
}

/** CSS `background` of the terminal region: the theme color, or nothing when the cells are translucent. */
export function backdropCss(a: Pick<AppearanceSettings, 'terminalOpacity'>): string {
  // Translucent terminal cells blend with what is behind the region, not with a second opaque fill.
  return a.terminalOpacity < 1 ? 'transparent' : 'var(--term-bg)'
}

export interface AppearanceDom {
  /** Custom properties on <html>. */
  vars: Record<string, string>
  /** data-* attributes on <html>, for CSS selectors (sidebar vibrancy). */
  data: Record<string, string>
}

export function toAppearanceDom(a: AppearanceSettings): AppearanceDom {
  const transparent = needsTransparency(a)
  return {
    vars: {
      '--tr-terminal-backdrop': backdropCss(a),
      // Layers that sit above the backdrop must not repaint it with an opaque fill.
      '--tr-term-surface': transparent ? 'transparent' : 'var(--term-bg)'
    },
    data: {
      vibrancy: a.sidebarVibrancy ? 'on' : 'off'
    }
  }
}
