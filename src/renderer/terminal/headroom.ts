// The pane's header is the top row of the terminal's card (Figma 55), and the grid runs under it. Until there is more
// than a screen of output nothing should be hidden there, so the grid sits lower by as much as its blank bottom rows
// allow; once the output scrolls, the old lines go under the header, which blurs them (TerminalArea .headerBlur). A
// full-screen program gets the rows below the header instead (TerminalArea moves the host down). Pure.
import type { IBuffer } from '@xterm/xterm'

export interface HeadroomInput {
  /** How far the header reaches over the grid's element (px); 0 = no header (the overview's borrowed terminal). */
  headroom: number
  /** The grid's top padding inside its element (px). */
  padTop: number
  /** One row (px). */
  cellHeight: number
  /** The alternate screen is active (vim, htop). */
  alt: boolean
  /** Rows of output above the screen (xterm's baseY), and the first row shown (viewportY). */
  baseY: number
  viewportY: number
  /** Blank rows at the bottom of the screen, below the cursor. */
  blankRows: number
}

export interface Headroom {
  /** How much lower the grid sits (px). */
  shift: number
  /** Text is under the header: the blur shows. */
  under: boolean
  alt: boolean
}

export function headroomFor({ headroom, padTop, cellHeight, alt, baseY, viewportY, blankRows }: HeadroomInput): Headroom {
  if (headroom <= 0 || cellHeight <= 0) return { shift: 0, under: false, alt: false }
  if (alt) return { shift: 0, under: false, alt: true }
  // Scrolled back to the first line: the bottom rows give way, so the first lines are not stuck under the header.
  if (baseY > 0 && viewportY === 0) return { shift: headroom, under: false, alt: false }
  if (baseY > 0) return { shift: 0, under: true, alt: false }
  const shift = Math.min(headroom, blankRows * cellHeight)
  return { shift, under: padTop + shift < headroom - 0.5, alt: false }
}

/**
 * Blank rows at the bottom of the screen, below the cursor, counting at most `max` (the rest does not matter). Only
 * the bottom few lines are read, so it is cheap enough for every render.
 */
export function blankBottomRows(buffer: Pick<IBuffer, 'baseY' | 'cursorY' | 'getLine'>, rows: number, max: number): number {
  let blank = 0
  for (let y = rows - 1; y > buffer.cursorY && blank < max; y--) {
    const line = buffer.getLine(buffer.baseY + y)
    if (line && line.translateToString(true) !== '') break
    blank++
  }
  return blank
}
