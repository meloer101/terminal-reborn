// Pure helpers that turn design tokens into xterm options.
import type { ITheme } from '@xterm/xterm'
import type { TerminalAppearance } from './surface'

/** Figma style Mono/Terminal: 13px type on a 20px line. xterm's lineHeight is a multiplier. */
export const DEFAULT_APPEARANCE: TerminalAppearance = {
  fontFamily: 'JetBrains Mono Variable',
  cjkFontFamily: 'PingFang SC',
  fontSize: 13,
  lineHeight: 20 / 13,
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

function parseHex(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(color.trim())
  if (!match?.[1]) return null
  const n = parseInt(match[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
}

/** Mixes `amount` (0..1) of `toward` into `base`; returns `base` unchanged if either is not a hex color. */
export function mixHex(base: string, toward: string, amount: number): string {
  const a = parseHex(base)
  const b = parseHex(toward)
  if (!a || !b) return base
  return toHex([a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount])
}

function isDark(color: string): boolean {
  const rgb = parseHex(color)
  if (!rgb) return true
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.5
}

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

export function readThemeFromDocument(): ITheme {
  const style = getComputedStyle(document.documentElement)
  return buildXtermTheme((name) => style.getPropertyValue(name).trim())
}
