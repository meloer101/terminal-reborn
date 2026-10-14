// Pure mapping from AppearanceSettings to what the renderer needs: xterm options, CSS variables
// for the background layers and <html> data attributes. No DOM access, so it is unit tested.
import type { AppearanceSettings, BackgroundSetting } from '@shared/settings'
import type { TerminalAppearance } from '../terminal/surface'

/** `file://` URL for an absolute POSIX path; every segment is percent-encoded. */
export function fileUrl(path: string): string {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * Alpha of the terminal's default cell background. A gradient or image has to show through the
 * cells, so those are fully transparent; a solid background uses the user's terminal opacity.
 */
export function terminalBackgroundAlpha(a: Pick<AppearanceSettings, 'background' | 'terminalOpacity'>): number {
  return a.background.kind === 'solid' ? a.terminalOpacity : 0
}

/** True when xterm needs `allowTransparency` (it costs subpixel text AA, so only then). */
export function needsTransparency(a: Pick<AppearanceSettings, 'background' | 'terminalOpacity'>): boolean {
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

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`
}

/**
 * CSS `background` shorthand painted on the terminal region, behind the xterm canvases.
 * Image: a `dim` veil in the theme's terminal color keeps text legible, then the image (cover).
 */
export function backdropCss(a: Pick<AppearanceSettings, 'background' | 'terminalOpacity'>): string {
  const bg: BackgroundSetting = a.background
  switch (bg.kind) {
    case 'gradient':
      return `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`
    case 'image': {
      const veil = `color-mix(in srgb, var(--term-bg) ${pct(bg.dim)}, transparent)`
      return `linear-gradient(${veil}, ${veil}), url("${fileUrl(bg.path)}") center / cover no-repeat var(--term-bg)`
    }
    case 'solid':
      // Translucent terminal cells blend with what is behind the region, not with a second opaque fill.
      return a.terminalOpacity < 1 ? 'transparent' : 'var(--term-bg)'
  }
}

export interface AppearanceDom {
  /** Custom properties on <html>. */
  vars: Record<string, string>
  /** data-* attributes on <html>, for CSS selectors (sidebar vibrancy, background kind). */
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
      bg: a.background.kind,
      vibrancy: a.sidebarVibrancy ? 'on' : 'off'
    }
  }
}
