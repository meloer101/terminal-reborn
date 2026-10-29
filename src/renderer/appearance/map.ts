// Pure mapping from AppearanceSettings to what the renderer needs: xterm options, CSS variables
// for the terminal layers and <html> data attributes. No DOM access, so it is unit tested.
// The terminal color comes from the theme (--term-bg: white in light mode, near-black in dark) unless the user chose
// or imported one (PRD F7 v1.71): then --term-bg is set on <html> to it and xterm gets the matching customTheme.
import type { AppearanceSettings } from '@shared/settings'
import { buildCustomTheme } from '../terminal/appearance'
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
    backgroundAlpha: terminalBackgroundAlpha(a),
    customTheme: hasCustomBackground(a) ? buildCustomTheme(a.terminalBackground.color, a.terminalColors) : undefined,
    screenReader: a.screenReader
  }
}

export function hasCustomBackground(a: Pick<AppearanceSettings, 'terminalBackground'>): boolean {
  return a.terminalBackground.mode === 'custom'
}

/** CSS `background` of the terminal region: the theme color, or nothing when the cells are translucent. */
export function backdropCss(a: Pick<AppearanceSettings, 'terminalOpacity'>): string {
  // Translucent terminal cells blend with what is behind the region, not with a second opaque fill.
  return a.terminalOpacity < 1 ? 'transparent' : 'var(--term-bg)'
}

/**
 * CSS color of the band around xterm's canvas (its padding and the sub-cell remainder of the fit). Translucent cells are
 * drawn inside the canvas only, so the band repeats the same color at the same alpha to keep the card one flat tone.
 */
export function ringCss(a: Pick<AppearanceSettings, 'terminalOpacity'>): string {
  if (a.terminalOpacity >= 1) return 'transparent'
  return `color-mix(in srgb, var(--term-bg) ${+(a.terminalOpacity * 100).toFixed(2)}%, transparent)`
}

export interface AppearanceDom {
  /** Custom properties on <html>; null removes the property (the stylesheet's value applies again). */
  vars: Record<string, string | null>
  /** Attributes on <html>. */
  attrs: Record<string, string>
}

export function toAppearanceDom(a: AppearanceSettings): AppearanceDom {
  const transparent = needsTransparency(a)
  return {
    vars: {
      // Only the terminal layers read --term-bg; --term-fg stays the theme's (the diff view uses it on app surfaces).
      '--term-bg': hasCustomBackground(a) ? a.terminalBackground.color : null,
      '--tr-terminal-backdrop': backdropCss(a),
      // Layers that sit above the backdrop must not repaint it with an opaque fill.
      '--tr-term-surface': transparent ? 'transparent' : 'var(--term-bg)',
      '--tr-term-ring': ringCss(a)
    },
    // The full-screen field (AppShell.module.css picks the palette, `auto` by theme).
    attrs: { 'data-fs-backdrop': a.fullscreenBackdrop }
  }
}
