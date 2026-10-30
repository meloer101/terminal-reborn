import type { IBuffer, IBufferCell, ITheme } from '@xterm/xterm'

/** What edgeFill reads of a cell (a subset of xterm's IBufferCell, so tests can pass plain objects). */
export type EdgeCell = Pick<IBufferCell, 'isBgDefault' | 'isBgRGB' | 'isBgPalette' | 'getBgColor' | 'isInverse'>

const ANSI: (keyof ITheme)[] = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
]
const CUBE = [0, 95, 135, 175, 215, 255]
const hex = (r: number, g: number, b: number) => `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`

/** A 256-color palette index as CSS: 0–15 from the theme, 16–231 the 6×6×6 cube, 232–255 the grey ramp. */
export function paletteColor(index: number, theme: ITheme): string | null {
  if (index < 16) return (theme[ANSI[index]!] as string | undefined) ?? null
  if (index < 232) {
    const i = index - 16
    return hex(CUBE[Math.floor(i / 36)]!, CUBE[Math.floor(i / 6) % 6]!, CUBE[i % 6]!)
  }
  const v = 8 + (index - 232) * 10
  return hex(v, v, v)
}

/**
 * The color to paint the padding around the grid with, or null for the terminal's own background. A full-screen
 * program that paints every cell itself (Grok fills each one with #141414 instead of setting the default background)
 * would otherwise sit in a ring of the theme color: when every cell on the grid's four edges has the same explicit
 * background, that color extends to the padding (Ghostty's `window-padding-color = extend`, simplified to one color).
 * A default or inverse cell anywhere on the edge keeps the theme color, so a shell or Claude Code never changes it.
 */
export function edgeFill(cellAt: (x: number, y: number) => EdgeCell | undefined, cols: number, rows: number, theme: ITheme): string | null {
  if (cols <= 0 || rows <= 0) return null
  let mode = 0
  let color = -1
  const same = (x: number, y: number): boolean => {
    const cell = cellAt(x, y)
    if (!cell || cell.isBgDefault() || cell.isInverse()) return false
    const m = cell.isBgRGB() ? 1 : cell.isBgPalette() ? 2 : 0
    if (m === 0) return false
    if (color === -1) {
      mode = m
      color = cell.getBgColor()
      return true
    }
    return m === mode && cell.getBgColor() === color
  }
  for (let x = 0; x < cols; x++) if (!same(x, 0) || !same(x, rows - 1)) return null
  for (let y = 1; y < rows - 1; y++) if (!same(0, y) || !same(cols - 1, y)) return null
  return mode === 1 ? hex((color >> 16) & 255, (color >> 8) & 255, color & 255) : paletteColor(color, theme)
}

/** edgeFill over the rows the buffer shows now (scrolled back or not), reusing one cell object for all reads. */
export function bufferEdgeFill(buffer: Pick<IBuffer, 'viewportY' | 'getLine' | 'getNullCell'>, cols: number, rows: number, theme: ITheme): string | null {
  const cell = buffer.getNullCell()
  return edgeFill((x, y) => buffer.getLine(buffer.viewportY + y)?.getCell(x, cell), cols, rows, theme)
}
