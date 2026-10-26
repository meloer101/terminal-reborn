// Terminal theme files → colors (PRD F7 · 导入主题). Two formats: a Ghostty theme (plain text, `palette = N=#rrggbb`,
// `background = …`; the files in Ghostty.app's `themes/` folder and `~/.config/ghostty/themes/`) and an iTerm2 color
// preset (`.itermcolors`, an XML plist of `Ansi N Color` dicts with 0–1 RGB components). Pure: main reads the file.
import { mixHex, normalizeHex, toHex } from './color'
import type { TerminalColors } from './settings'

export interface ImportedTheme {
  background: string
  colors: TerminalColors
}

export type ThemeParseResult = { ok: true; theme: ImportedTheme } | { ok: false; reason: ThemeParseFailure }

/** `unsupported`: not a theme file we read (a binary plist, an unknown format). `incomplete`: a color is missing. */
export type ThemeParseFailure = 'unsupported' | 'incomplete'

/** Files larger than this are not themes. */
export const MAX_THEME_FILE_BYTES = 256 * 1024

const ANSI_COUNT = 16

/** Selection is not part of every theme: a quarter of the way from the background to the foreground reads as one. */
function fallbackSelection(background: string, foreground: string): string {
  return mixHex(background, foreground, 0.25)
}

function assemble(parts: {
  background: string | null
  foreground: string | null
  cursor: string | null
  selection: string | null
  ansi: Array<string | null>
}): ThemeParseResult {
  const { background, foreground, ansi } = parts
  if (!background || !foreground || ansi.length !== ANSI_COUNT || ansi.some((color) => color === null)) {
    return { ok: false, reason: 'incomplete' }
  }
  return {
    ok: true,
    theme: {
      background,
      colors: {
        foreground,
        cursor: parts.cursor ?? foreground,
        selection: parts.selection ?? fallbackSelection(background, foreground),
        ansi: ansi as string[]
      }
    }
  }
}

/** A Ghostty theme: `key = value` lines, `#` comments, `palette = 0=#262427` (0–15 are the ANSI colors). */
export function parseGhosttyTheme(text: string): ThemeParseResult {
  const values = new Map<string, string>()
  const ansi: Array<string | null> = Array.from({ length: ANSI_COUNT }, () => null)
  let sawKey = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    sawKey = true
    if (key === 'palette') {
      const inner = value.indexOf('=')
      const index = Number(value.slice(0, inner).trim())
      if (inner > 0 && Number.isInteger(index) && index >= 0 && index < ANSI_COUNT) ansi[index] = normalizeHex(value.slice(inner + 1))
    } else {
      values.set(key, value)
    }
  }
  if (!sawKey) return { ok: false, reason: 'unsupported' }
  return assemble({
    background: normalizeHex(values.get('background')),
    foreground: normalizeHex(values.get('foreground')),
    cursor: normalizeHex(values.get('cursor-color')),
    selection: normalizeHex(values.get('selection-background')),
    ansi
  })
}

function component(dict: string, name: string): number | null {
  const match = new RegExp(`<key>${name} Component</key>\\s*<(?:real|integer)>\\s*([-+0-9.eE]+)\\s*</(?:real|integer)>`).exec(dict)
  if (!match?.[1]) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

/** The color stored under `<key>name</key><dict>…</dict>`, as `#rrggbb`. */
function itermColor(text: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`<key>${escaped}</key>\\s*<dict>([\\s\\S]*?)</dict>`).exec(text)
  if (!match?.[1]) return null
  const red = component(match[1], 'Red')
  const green = component(match[1], 'Green')
  const blue = component(match[1], 'Blue')
  if (red === null || green === null || blue === null) return null
  return toHex([red * 255, green * 255, blue * 255])
}

/** An iTerm2 `.itermcolors` file (XML plist). A binary plist is not read. */
export function parseItermColors(text: string): ThemeParseResult {
  if (text.startsWith('bplist') || !/<plist[\s>]/.test(text)) return { ok: false, reason: 'unsupported' }
  return assemble({
    background: itermColor(text, 'Background Color'),
    foreground: itermColor(text, 'Foreground Color'),
    cursor: itermColor(text, 'Cursor Color'),
    selection: itermColor(text, 'Selection Color'),
    ansi: Array.from({ length: ANSI_COUNT }, (_, index) => itermColor(text, `Ansi ${index} Color`))
  })
}

/** Picks the reader by content: a plist is an iTerm preset, anything else is read as a Ghostty theme. */
export function parseThemeFile(text: string): ThemeParseResult {
  const head = text.slice(0, 2048)
  if (head.startsWith('bplist') || /<\?xml|<plist[\s>]/.test(head)) return parseItermColors(text)
  return parseGhosttyTheme(text)
}
