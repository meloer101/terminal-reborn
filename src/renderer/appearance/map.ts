// Pure mapping from AppearanceSettings to what the renderer needs: xterm options, CSS variables
// for the terminal layers and <html> data attributes. No DOM access, so it is unit tested.
// The terminal color comes from the theme (--term-bg: white in light mode, near-black in dark) unless the user chose
// or imported one (PRD F7 v1.71): then --term-bg is set on <html> to it and xterm gets the matching customTheme.
import type { AppearanceSettings, ChatAppearance, ChatWidth, WindowMaterial } from '@shared/settings'
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

/** 对话宽度 (Figma 51): the chat column; `full` fills the card. Claude desktop's Narrow / Medium / Wide plus a full one. */
export const CHAT_COLUMN: Record<ChatWidth, string> = { narrow: '720px', medium: '960px', wide: '1280px', full: '100%' }

const quote = (family: string): string => `"${family.replace(/["\\]/g, '')}"`

/** The chat's font stack: the chosen Latin family (or the system UI font), the CJK one, then the UI stack. */
export function chatFontStack(c: Pick<ChatAppearance, 'latinFont' | 'cjkFont'>): string {
  const latin = c.latinFont ? quote(c.latinFont) : '-apple-system, BlinkMacSystemFont'
  return `${latin}, ${quote(c.cjkFont)}, var(--font-ui)`
}

/** The window material actually shown: Liquid Glass needs macOS 26 (main/appearance.ts). */
export const shownMaterial = (a: Pick<AppearanceSettings, 'windowMaterial'>, liquidGlass: boolean): WindowMaterial =>
  liquidGlass && a.windowMaterial === 'liquid' ? 'liquid' : 'frosted'

/** A theme color at `opacity` over what is behind it; fully opaque is the color itself, none is transparent. */
const over = (color: string, opacity: number): string =>
  opacity >= 1 ? color : opacity <= 0 ? 'transparent' : `color-mix(in srgb, ${color} ${+(opacity * 100).toFixed(2)}%, transparent)`

export function toAppearanceDom(a: AppearanceSettings, liquidGlass: boolean): AppearanceDom {
  const transparent = needsTransparency(a)
  const chat = a.chat
  return {
    vars: {
      // 窗口底层不透明度 (PRD §5 v1.127): the theme's shell color over the base layer, per material.
      '--glass-shell': over('var(--glass-shell-color)', a.shellOpacity[shownMaterial(a, liquidGlass)]),
      // 对话 (Figma 51D): GUI sessions read these (gui/Chat.module.css).
      '--chat-column': CHAT_COLUMN[chat.width],
      '--chat-font': chatFontStack(chat),
      '--chat-weight': String(chat.fontWeight),
      '--chat-size': `${chat.fontSize}px`,
      // 14 / 22 today: the same leading at every size.
      '--chat-leading': `${Math.round(chat.fontSize * (22 / 14))}px`,
      '--tr-chat-bg': over('var(--bg-app)', chat.opacity),
      // The user's picture beside their messages (Figma 51A); none hides it (data-chat-avatar).
      '--chat-avatar': chat.avatar ? `url("${chat.avatar}")` : null,
      // Only the terminal layers read --term-bg; --term-fg stays the theme's (the diff view uses it on app surfaces).
      '--term-bg': hasCustomBackground(a) ? a.terminalBackground.color : null,
      '--tr-terminal-backdrop': backdropCss(a),
      // Layers that sit above the backdrop must not repaint it with an opaque fill.
      '--tr-term-surface': transparent ? 'transparent' : 'var(--term-bg)',
      '--tr-term-ring': ringCss(a)
    },
    // The full-screen field (AppShell.module.css picks the palette, `auto` by theme).
    attrs: { 'data-fs-backdrop': a.fullscreenBackdrop, 'data-chat-avatar': chat.avatar ? 'on' : 'off' }
  }
}
