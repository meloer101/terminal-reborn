import { Terminal } from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import { readBufferText } from './screen-text'

function write(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve))
}

describe('readBufferText', () => {
  it('reads the screen and trims trailing blank lines', async () => {
    const term = new Terminal({ cols: 20, rows: 5, allowProposedApi: true })
    await write(term, 'hello\r\nworld')
    expect(readBufferText(term.buffer.active, term.rows, 0)).toBe('hello\nworld')
  })

  it('includes scrollback on request', async () => {
    const term = new Terminal({ cols: 20, rows: 3, allowProposedApi: true })
    await write(term, ['one', 'two', 'three', 'four', 'five'].join('\r\n'))
    expect(readBufferText(term.buffer.active, term.rows, 0)).toBe('three\nfour\nfive')
    expect(readBufferText(term.buffer.active, term.rows, 2)).toBe('one\ntwo\nthree\nfour\nfive')
    expect(readBufferText(term.buffer.active, term.rows, 100)).toBe('one\ntwo\nthree\nfour\nfive')
  })

  it('rejoins soft-wrapped lines', async () => {
    const term = new Terminal({ cols: 10, rows: 5, allowProposedApi: true })
    await write(term, 'abcdefghijklmnopqrst\r\nnext')
    expect(readBufferText(term.buffer.active, term.rows, 0)).toBe('abcdefghijklmnopqrst\nnext')
  })

  it('keeps CJK text intact', async () => {
    const term = new Terminal({ cols: 20, rows: 3, allowProposedApi: true })
    await write(term, '你好，世界\r\nok')
    expect(readBufferText(term.buffer.active, term.rows, 0)).toBe('你好，世界\nok')
  })
})
