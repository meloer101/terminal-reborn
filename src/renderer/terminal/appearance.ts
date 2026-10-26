// Pure helpers that turn design tokens into xterm options.
import type { ITheme } from '@xterm/xterm'
import { isDarkColor, mixHex } from '@shared/color'
import type { TerminalColors } from '@shared/settings'
import { TERMINAL_TOKENS } from '@shared/terminal-tokens'
import type { TerminalAppearance } from './surface'

/** 13px JetBrains Mono at its natural line height, like a normal terminal (xterm's lineHeight multiplies it). */
export const DEFAULT_APPEARANCE: TerminalAppearance = {
  fontFamily: 'JetBrains Mono Variable',
  cjkFontFamily: 'PingFang SC',
  fontSize: 13,
  lineHeight: 1,
  ligatures: false
}

function quoteFamily(family: string): string {
  const trimmed = family.trim()
  // Already a stack or already quoted: leave it alone.
  return /["',]/.test(trimmed) ? trimmed : `"${trimmed}"`
}

/** `"<latin>", "<cjk>", monospace` — a CJK family is always present so CJK takes 2 cells. */
export function buildFontStack(appearance: Pick<TerminalAppearance, 'fontFamily' | 'cjkFontFamily'>): string {
  return [quoteFamily(appearance.fontFamily), quoteFamily(appearance.cjkFontFamily), 'monospace'].join(', ')
}

export { mixHex }
const isDark = isDarkColor

/** Builds the xterm theme from the `--term-*` variables. `read` returns a variable's resolved value. */
export function buildXtermTheme(read: (name: string) => string): ITheme {
  const bg = read('--term-bg')
  const fg = read('--term-fg')
  const dim = read('--term-dim')
  const red = read('--term-red')
  const green = read('--term-green')
  const yellow = read('--term-yellow')
  const blue = read('--term-blue')
  const violet = read('--term-violet')
  const cyan = read('--term-cyan')
  const selection = read('--term-selection')

  // ANSI black/white are the two neutrals; keep both legible against the background.
  const dark = isDark(bg)
  const black = dark ? mixHex(bg, fg, 0.12) : fg
  const white = dark ? fg : mixHex(bg, fg, 0.12)

  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: selection,
    selectionInactiveBackground: selection,
    black,
    red,
    green,
    yellow,
    blue,
    magenta: violet,
    cyan,
    white,
    // Chroma stays low: bright variants share the hue, only the neutrals step.
    brightBlack: dim,
    brightRed: red,
    brightGreen: green,
    brightYellow: yellow,
    brightBlue: blue,
    brightMagenta: violet,
    brightCyan: cyan,
    brightWhite: dark ? mixHex(fg, '#ffffff', 0.4) : bg
  }
}

/**
 * The xterm theme on a user-chosen background (PRD F7 v1.71). Without imported colors the foreground and ANSI colors
 * are the tokens of the tone that suits the background's lightness; with them (an imported Ghostty / iTerm theme) the
 * theme's own colors are used as they are, so the terminal shows exactly the colors that were imported.
 */
export function buildCustomTheme(background: string, colors: TerminalColors | null): ITheme {
  const tokens: Record<string, string> = { ...TERMINAL_TOKENS[isDark(background) ? 'dark' : 'light'], '--term-bg': background }
  const base = buildXtermTheme((name) => tokens[name] ?? '')
  if (!colors) return base
  const [black, red, green, yellow, blue, magenta, cyan, white, brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] =
    colors.ansi
  return {
    ...base,
    foreground: colors.foreground,
    cursor: colors.cursor,
    selectionBackground: colors.selection,
    selectionInactiveBackground: colors.selection,
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack,
    brightRed,
    brightGreen,
    brightYellow,
    brightBlue,
    brightMagenta,
    brightCyan,
    brightWhite
  }
}

export function readThemeFromDocument(): ITheme {
  const style = getComputedStyle(document.documentElement)
  return buildXtermTheme((name) => style.getPropertyValue(name).trim())
}

/** `#rrggbb` + alpha (0–1) → `#rrggbbaa`; anything that is not a 6-digit hex color is returned as is. */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(color.trim())
  if (!match?.[1]) return color
  const clamped = Math.min(1, Math.max(0, alpha))
  return `#${match[1]}${Math.round(clamped * 255).toString(16).padStart(2, '0')}`
}
