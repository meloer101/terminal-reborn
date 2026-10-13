// Plain-text extraction from an xterm buffer, used by TerminalSurface.readScreen().

export interface BufferLineLike {
  readonly isWrapped: boolean
  translateToString(trimRight?: boolean): string
}

export interface BufferLike {
  /** Total lines: scrollback plus screen. */
  readonly length: number
  /** Index of the first line of the live screen. */
  readonly baseY: number
  getLine(y: number): BufferLineLike | undefined
}

/**
 * The live screen (`rows` lines) plus up to `scrollbackLines` lines above it.
 * Soft-wrapped lines are joined back into one logical line so needles are not split
 * by the terminal width. Trailing blank lines are dropped.
 */
export function readBufferText(buffer: BufferLike, rows: number, scrollbackLines: number): string {
  const start = Math.max(0, buffer.baseY - Math.max(0, scrollbackLines))
  const end = Math.min(buffer.length, buffer.baseY + rows)
  const lines: string[] = []
  for (let y = start; y < end; y++) {
    const line = buffer.getLine(y)
    if (!line) continue
    const continues = buffer.getLine(y + 1)?.isWrapped === true && y + 1 < end
    const text = line.translateToString(!continues)
    if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text
    else lines.push(text)
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}
