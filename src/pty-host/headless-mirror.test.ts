import { Terminal } from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import { HeadlessMirror, modeSequences } from './headless-mirror'

function replay(screen: { data: string; modes: string; cols: number; rows: number }): Promise<Terminal> {
  const term = new Terminal({ cols: screen.cols, rows: screen.rows, allowProposedApi: true })
  return new Promise((resolve) => term.write(screen.data + screen.modes, () => resolve(term)))
}

function lines(term: Terminal): string[] {
  const buffer = term.buffer.active
  const out: string[] = []
  for (let y = 0; y < buffer.length; y++) out.push((buffer.getLine(y)?.translateToString(true) ?? '').trimEnd())
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out
}

describe('HeadlessMirror', () => {
  it('replays a plain shell screen with its cursor position', async () => {
    const mirror = new HeadlessMirror(40, 6)
    mirror.write('$ echo hi\r\nhi\r\n$ ')
    const { seq, screen } = await mirror.capture()
    expect(seq).toBe('$ echo hi\r\nhi\r\n$ '.length)
    const term = await replay(screen)
    expect(lines(term)).toEqual(['$ echo hi', 'hi', '$'])
    expect(term.buffer.active.cursorX).toBe(2)
    expect(term.buffer.active.cursorY).toBe(2)
    expect(term.buffer.active.type).toBe('normal')
  })

  it('brings back an active alternate screen and the modes a full-screen program set', async () => {
    const mirror = new HeadlessMirror(40, 6)
    mirror.write('history line\r\n')
    mirror.write('\x1b[?1049h\x1b[2J\x1b[Htop bar\x1b[4;1Hprompt> ')
    mirror.write('\x1b[?2004h\x1b[?1h\x1b[?1004h\x1b[?1002h\x1b[?1006h\x1b[?25l')
    mirror.write('\x1b]0;✳ Claude\x07')
    const { screen } = await mirror.capture()
    expect(screen.title).toBe('✳ Claude')
    const term = await replay(screen)
    expect(term.buffer.active.type).toBe('alternate')
    expect(lines(term)).toEqual(['top bar', '', '', 'prompt>'])
    expect(term.buffer.normal.getLine(0)?.translateToString(true)).toBe('history line')
    expect(term.modes.bracketedPasteMode).toBe(true)
    expect(term.modes.applicationCursorKeysMode).toBe(true)
    expect(term.modes.sendFocusMode).toBe(true)
    expect(term.modes.mouseTrackingMode).toBe('drag')
    expect(screen.modes).toContain('\x1b[?1006h')
    expect(screen.modes).toContain('\x1b[?25l')
  })

  it('cuts exactly at the position of the capture call, even with writes queued behind it', async () => {
    const mirror = new HeadlessMirror(20, 4)
    mirror.write('one\r\n')
    const captured = mirror.capture()
    mirror.write('two\r\n')
    const { seq, screen } = await captured
    expect(seq).toBe(5)
    expect(lines(await replay(screen))).toEqual(['one'])
    expect(mirror.position).toBe(10)
  })

  it('follows resizes', async () => {
    const mirror = new HeadlessMirror(20, 4)
    mirror.resize(30, 8)
    const { screen } = await mirror.capture()
    expect(screen).toMatchObject({ cols: 30, rows: 8 })
  })
})

describe('modeSequences', () => {
  it('emits nothing for a fresh terminal', () => {
    expect(
      modeSequences({
        applicationCursor: false,
        applicationKeypad: false,
        bracketedPaste: false,
        focusEvents: false,
        cursorHidden: false,
        mouseTracking: 'none',
        mouseEncoding: 'DEFAULT'
      })
    ).toBe('')
  })

  it('assumes SGR encoding for a tracking program when the encoding is unknown', () => {
    const seq = modeSequences({
      applicationCursor: false,
      applicationKeypad: false,
      bracketedPaste: false,
      focusEvents: false,
      cursorHidden: false,
      mouseTracking: 'vt200'
    })
    expect(seq).toBe('\x1b[?1000h\x1b[?1006h')
  })
})
