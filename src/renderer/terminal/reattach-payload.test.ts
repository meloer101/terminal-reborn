import { describe, expect, it } from 'vitest'
import { reattachPayload, uncovered } from './reattach-payload'

describe('reattachPayload', () => {
  it('clears, draws the screen, then restores modes and the title', () => {
    const payload = reattachPayload({ data: 'SCREEN', cols: 80, rows: 24, modes: '\x1b[?1000h', title: '✳ Claude' })
    expect(payload.startsWith('\x1b[?2026l\x1b[0m\x1b[2J\x1b[3J\x1b[H')).toBe(true)
    expect(payload.indexOf('SCREEN')).toBeLessThan(payload.indexOf('\x1b[?1000h'))
    expect(payload.endsWith('\x1b]2;✳ Claude\x07')).toBe(true)
  })

  it('never lets a title break out of its OSC sequence', () => {
    const payload = reattachPayload({ data: '', cols: 80, rows: 24, modes: '', title: 'a\x07\x1b[2Jb' })
    expect(payload.endsWith('\x1b]2;a[2Jb\x07')).toBe(true)
  })
})

describe('uncovered', () => {
  it('drops chunks the screen already covers and keeps later ones whole', () => {
    expect(uncovered('abc', 10, 10)).toBe('')
    expect(uncovered('abc', 8, 10)).toBe('')
    expect(uncovered('abc', 13, 10)).toBe('abc')
  })

  it('slices a chunk that straddles the screen position', () => {
    expect(uncovered('abcdef', 12, 10)).toBe('ef')
  })
})
