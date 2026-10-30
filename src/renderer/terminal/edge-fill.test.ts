import { Terminal } from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import { bufferEdgeFill, paletteColor } from './edge-fill'

const THEME = { background: '#0a0a0a', black: '#000000', blue: '#3b82f6' }

async function fill(data: string, cols = 12, rows = 5): Promise<string | null> {
  const term = new Terminal({ cols, rows, allowProposedApi: true })
  await new Promise<void>((resolve) => term.write(data, resolve))
  return bufferEdgeFill(term.buffer.active, cols, rows, THEME)
}

describe('edgeFill', () => {
  it('extends a full-screen program’s own background (Grok: every cell #141414, erased with it)', async () => {
    expect(await fill('\x1b[?1049h\x1b[48;2;20;20;20m\x1b[2J\x1b[3;3H\x1b[38;2;200;200;200mGrok')).toBe('#141414')
  })

  it('keeps the theme color for a shell or Claude Code (default background on the edge)', async () => {
    expect(await fill('$ ls\r\nfile')).toBeNull()
    // Claude Code's input box: a colored block that does not reach every edge.
    expect(await fill('\r\n\x1b[48;5;238m  prompt  \x1b[K\x1b[0m')).toBeNull()
  })

  it('keeps the theme color when the edges disagree', async () => {
    expect(await fill('\x1b[48;2;20;20;20m\x1b[2J\x1b[5;1H\x1b[48;2;30;30;30m\x1b[K')).toBeNull()
  })

  it('keeps the theme color when an edge cell is inverse', async () => {
    expect(await fill('\x1b[48;2;20;20;20m\x1b[2J\x1b[1;1H\x1b[7mX')).toBeNull()
  })

  it('resolves palette backgrounds through the theme and the 256-color table', async () => {
    expect(await fill('\x1b[44m\x1b[2J')).toBe('#3b82f6')
    expect(await fill('\x1b[48;5;235m\x1b[2J')).toBe('#262626')
  })

  it('reads the rows shown while scrolled back', async () => {
    const term = new Terminal({ cols: 6, rows: 3, allowProposedApi: true })
    await new Promise<void>((resolve) => term.write('\x1b[48;2;20;20;20m' + 'xxxxxx\r\n'.repeat(3) + '\x1b[0m' + 'a\r\nb\r\nc', resolve))
    expect(bufferEdgeFill(term.buffer.active, 6, 3, THEME)).toBeNull()
    term.scrollToTop()
    expect(bufferEdgeFill(term.buffer.active, 6, 3, THEME)).toBe('#141414')
  })
})

describe('paletteColor', () => {
  it('maps the cube and the grey ramp like xterm', () => {
    expect(paletteColor(16, THEME)).toBe('#000000')
    expect(paletteColor(231, THEME)).toBe('#ffffff')
    expect(paletteColor(196, THEME)).toBe('#ff0000')
    expect(paletteColor(232, THEME)).toBe('#080808')
    expect(paletteColor(255, THEME)).toBe('#eeeeee')
    expect(paletteColor(3, THEME)).toBeNull()
  })
})
