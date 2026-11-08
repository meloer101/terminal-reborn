import { describe, expect, it } from 'vitest'
import { ansiSpans } from './ansi'
import { plainOutput } from './model'

describe('ansiSpans: a command’s colors in its output', () => {
  it('keeps plain text as one span', () => {
    expect(ansiSpans('12 passed\ndone')).toEqual([{ text: '12 passed\ndone' }])
    expect(ansiSpans('')).toEqual([])
  })

  it('reads bold, dim and the eight colors, bright ones as the same names', () => {
    expect(ansiSpans('\x1b[1m\x1b[32m✓\x1b[39m\x1b[22m 12 passed')).toEqual([{ text: '✓', fg: 'green', bold: true }, { text: ' 12 passed' }])
    expect(ansiSpans('\x1b[91mFAIL\x1b[0m \x1b[2;36mnote\x1b[22m.\x1b[m')).toEqual([
      { text: 'FAIL', fg: 'red' },
      { text: ' ' },
      { text: 'note', fg: 'cyan', dim: true },
      { text: '.', fg: 'cyan' }
    ])
    const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
    names.forEach((name, i) => {
      expect(ansiSpans(`\x1b[${30 + i}mx`)).toEqual([{ text: 'x', fg: name }])
      expect(ansiSpans(`\x1b[${90 + i}mx`)).toEqual([{ text: 'x', fg: name }])
    })
  })

  it('skips 256 and true colors without reading their numbers as codes', () => {
    expect(ansiSpans('\x1b[38;5;31ma\x1b[38;2;1;2;3;1mb\x1b[4;33mc')).toEqual([{ text: 'a' }, { text: 'b', bold: true }, { text: 'c', fg: 'yellow', bold: true }])
  })

  it('drops every other escape, as plainOutput does', () => {
    const raw = '\x1b]0;vitest\x07\x1b[1m\x1b[32m✓\x1b[39m\x1b[22m 12 passed\n\x1b[2K\x1b[1Gdone\x1b(B'
    expect(ansiSpans(raw)).toEqual([{ text: '✓', fg: 'green', bold: true }, { text: ' 12 passed\ndone' }])
    expect(ansiSpans(raw).map((s) => s.text).join('')).toBe(plainOutput(raw))
    // The kept tail of a long output can start inside a sequence whose ESC was cut off.
    expect(ansiSpans('…[0m tail')).toEqual([{ text: '… tail' }])
  })
})
