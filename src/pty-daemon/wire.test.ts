import { describe, expect, it } from 'vitest'
import { frame, LineReader, MAX_FRAME_CHARS } from './wire'

function reader(): { lines: LineReader; messages: unknown[]; errors: string[] } {
  const messages: unknown[] = []
  const errors: string[] = []
  return { lines: new LineReader((m) => messages.push(m), (e) => errors.push(e.message)), messages, errors }
}

describe('LineReader', () => {
  it('splits several frames in one chunk and skips blank lines', () => {
    const { lines, messages } = reader()
    lines.push(`{"a":1}\n\n{"b":2}\n{"c"`)
    lines.push(':3}\n')
    expect(messages).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })

  it('reassembles a large frame split across many chunks, with frames before and after it', () => {
    const { lines, messages, errors } = reader()
    const payload = { type: 'hook' as const, rid: 1, sessionId: 's1', event: 'PostToolUse', agent: 'claude' as const, payload: { text: 'é中'.repeat(500_000) } }
    const text = `${frame({ type: 'system-shutdown' })}${frame(payload)}${frame({ type: 'shutdown', killSessions: false })}`
    for (let i = 0; i < text.length; i += 1000) lines.push(text.slice(i, i + 1000))
    expect(errors).toEqual([])
    expect(messages).toEqual([{ type: 'system-shutdown' }, payload, { type: 'shutdown', killSessions: false }])
  })

  it('handles a chunk that is exactly a newline, and newlines at chunk edges', () => {
    const { lines, messages } = reader()
    for (const chunk of ['{"a"', ':1}', '\n', '\n{"b":2}', '\n']) lines.push(chunk)
    expect(messages).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('scans a frame split into many chunks in linear time', () => {
    const { lines, messages } = reader()
    const body = JSON.stringify({ text: 'x'.repeat(8 * 1024 * 1024) })
    const started = performance.now()
    for (let i = 0; i < body.length; i += 64) lines.push(body.slice(i, i + 64))
    lines.push('\n')
    expect(messages).toHaveLength(1)
    // ~130 000 chunks; rescanning from 0 each time would be ~10^11 char reads.
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('reports a malformed frame and recovers on the next one', () => {
    const { lines, messages, errors } = reader()
    lines.push('{"a":')
    lines.push('nope}\n{"b":2}\n')
    expect(errors).toEqual(['malformed frame'])
    expect(messages).toEqual([])
    lines.push('{"c":3}\n')
    expect(messages).toEqual([{ c: 3 }])
  })

  it('gives up on a frame larger than the limit', () => {
    const { lines, errors } = reader()
    const piece = 'x'.repeat(8 * 1024 * 1024)
    for (let sent = 0; sent <= MAX_FRAME_CHARS && errors.length === 0; sent += piece.length) lines.push(piece)
    expect(errors).toEqual(['frame too large'])
  })
})
