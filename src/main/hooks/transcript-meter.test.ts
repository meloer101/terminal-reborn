import { describe, expect, it } from 'vitest'
import { emptyMeterState, historyOf, parseLines, spendSince, TranscriptMeter, type RangeReader } from './transcript-meter'

const T0 = Date.parse('2026-10-19T10:00:00.000Z')
const ts = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString()
const line = (value: unknown) => JSON.stringify(value)

const assistant = (minute: number, id: string, usage: Record<string, number>, extra: Record<string, unknown> = {}) =>
  line({ type: 'assistant', timestamp: ts(minute), message: { id, usage }, ...extra })
const prompt = (minute: number, content: unknown = '修一下导航') => line({ type: 'user', timestamp: ts(minute), message: { role: 'user', content } })

describe('parseLines · Claude transcript', () => {
  it('counts each message once, closes a turn at each typed prompt and marks compactions', () => {
    const state = emptyMeterState()
    parseLines(
      'claude',
      state,
      [
        prompt(0),
        // One message written as two lines (text, then a tool call), the second with its final output count.
        assistant(1, 'm1', { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 20_000, output_tokens: 50 }),
        assistant(1, 'm1', { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 20_000, output_tokens: 80 }),
        line({ type: 'user', timestamp: ts(2), message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }),
        assistant(2, 'm2', { input_tokens: 5, cache_creation_input_tokens: 500, cache_read_input_tokens: 21_000, output_tokens: 20 }),
        // A subagent's message: its spend counts, its context does not.
        assistant(3, 'm3', { input_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 90_000, output_tokens: 3 }, { isSidechain: true }),
        prompt(4, [{ type: 'text', text: '继续' }]),
        line({ type: 'user', timestamp: ts(4), isMeta: true, message: { role: 'user', content: 'caveat' } }),
        assistant(5, 'm4', { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 30_000, output_tokens: 10 }),
        line({ type: 'system', subtype: 'compact_boundary', timestamp: ts(6) }),
        'not json',
        assistant(7, 'm5', { input_tokens: 2, cache_creation_input_tokens: 8000, cache_read_input_tokens: 0, output_tokens: 4 })
      ],
      T0
    )
    expect(historyOf(state)).toEqual({
      turns: [
        { at: T0 + 2 * 60_000, tokens: 21_505 },
        { at: T0 + 5 * 60_000, tokens: 30_001 },
        { at: T0 + 7 * 60_000, tokens: 8_002 }
      ],
      compactions: [T0 + 6 * 60_000]
    })
    // m1 1010 + 80, m2 505 + 20, m3 7 + 3, m4 1 + 10, m5 8002 + 4.
    expect(spendSince(state, T0)).toBe(1090 + 525 + 10 + 11 + 8006)
    expect(spendSince(state, T0 + 5 * 60_000)).toBe(11 + 8006)
  })
})

describe('parseLines · Codex rollout', () => {
  const tokenCount = (minute: number, cumulative: number, last: Record<string, number>) =>
    line({
      timestamp: ts(minute),
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: { total_tokens: cumulative }, last_token_usage: last, model_context_window: 258_400 } }
    })

  it('takes new spend from a growing running total and turns from user messages', () => {
    const state = emptyMeterState()
    const first = { input_tokens: 12_000, cached_input_tokens: 10_000, output_tokens: 300, total_tokens: 12_300 }
    parseLines(
      'codex',
      state,
      [
        line({ timestamp: ts(0), type: 'event_msg', payload: { type: 'user_message', message: 'go' } }),
        tokenCount(1, 12_300, first),
        // Repeated when only the rate limits changed.
        tokenCount(1, 12_300, first),
        line({ timestamp: ts(2), type: 'event_msg', payload: { type: 'user_message', message: 'more' } }),
        tokenCount(3, 40_000, { input_tokens: 27_000, cached_input_tokens: 12_000, output_tokens: 700, total_tokens: 27_700 }),
        line({ timestamp: ts(4), type: 'compacted', payload: { message: '' } })
      ],
      T0
    )
    expect(historyOf(state)).toEqual({
      turns: [
        { at: T0 + 60_000, tokens: 12_300 },
        { at: T0 + 3 * 60_000, tokens: 27_700 }
      ],
      compactions: [T0 + 4 * 60_000],
      windowTokens: 258_400
    })
    expect(spendSince(state, 0)).toBe(2_000 + 300 + 15_000 + 700)
  })
})

/** An in-memory file the meter reads like the real one, a few bytes at a time to exercise the carry. */
function fakeFiles(chunk = 64) {
  const files = new Map<string, string>()
  const read: RangeReader = async (path, start) => {
    const text = files.get(path)
    if (text === undefined) throw new Error('ENOENT')
    const bytes = Buffer.from(text)
    const end = Math.min(bytes.length, start + chunk)
    return { text: bytes.subarray(start, end).toString('utf8'), size: bytes.length, end: Math.max(start, end) }
  }
  return { files, read }
}

const dirs = { claudeProjects: ['/home/u/.claude/projects'], codexHome: '/home/u/.codex' }
const noTimers = { setTimeout: () => 0, clearTimeout: () => undefined }

describe('TranscriptMeter', () => {
  const path = '/home/u/.claude/projects/p/one.jsonl'

  it('reads incrementally, across chunk boundaries, only inside the agent data directory', async () => {
    const { files, read } = fakeFiles(37)
    const meter = new TranscriptMeter({ dirs, read, scheduler: noTimers, now: () => T0 })
    files.set(path, [prompt(0), assistant(1, 'a', { input_tokens: 100, output_tokens: 1 })].join('\n') + '\n')
    meter.observe('s1', 'claude', 'Stop', { transcript_path: path })
    meter.observe('s2', 'claude', 'Stop', { transcript_path: '/etc/passwd.jsonl' })
    expect((await meter.history('s1'))?.turns).toEqual([{ at: T0 + 60_000, tokens: 100 }])
    expect(await meter.history('s2')).toEqual({ turns: [], compactions: [] })

    files.set(path, files.get(path)! + [prompt(2), assistant(3, 'b', { input_tokens: 300, output_tokens: 2 })].join('\n') + '\n')
    expect((await meter.history('s1'))?.turns.map((t) => t.tokens)).toEqual([100, 300])
    expect(await meter.spend('claude', T0)).toEqual([{ sessionId: 's1', tokens: 403 }])
    expect(await meter.spend('codex', T0)).toEqual([])
  })

  it('starts the history over for a new transcript file, but keeps the spend; keeps spend after the session ends', async () => {
    const { files, read } = fakeFiles()
    const meter = new TranscriptMeter({ dirs, read, scheduler: noTimers, now: () => T0 })
    files.set(path, assistant(1, 'a', { input_tokens: 100, output_tokens: 0 }) + '\n')
    meter.observe('s1', 'claude', 'Stop', { transcript_path: path })
    await meter.history('s1')
    const next = '/home/u/.claude/projects/p/two.jsonl'
    files.set(next, assistant(5, 'b', { input_tokens: 40, output_tokens: 0 }) + '\n')
    meter.observe('s1', 'claude', 'SessionStart', { transcript_path: next })
    expect((await meter.history('s1'))?.turns).toEqual([{ at: T0 + 5 * 60_000, tokens: 40 }])
    expect(await meter.spend('claude', T0)).toEqual([{ sessionId: 's1', tokens: 140 }])
    meter.forget('s1')
    expect(await meter.history('s1')).toBeNull()
    expect(await meter.spend('claude', T0)).toEqual([{ sessionId: 's1', tokens: 140 }])
  })

  it('reads again from the top when the file was replaced by a shorter one', async () => {
    const { files, read } = fakeFiles()
    const meter = new TranscriptMeter({ dirs, read, scheduler: noTimers, now: () => T0 })
    files.set(path, [assistant(1, 'a', { input_tokens: 5000 }), assistant(2, 'b', { input_tokens: 6000 })].join('\n') + '\n')
    meter.observe('s1', 'claude', 'Stop', { transcript_path: path })
    await meter.history('s1')
    files.set(path, assistant(3, 'c', { input_tokens: 7 }) + '\n')
    expect((await meter.history('s1'))?.turns).toEqual([{ at: T0 + 3 * 60_000, tokens: 7 }])
  })

  it('schedules reads after hooks that follow a response', () => {
    const scheduled: number[] = []
    const meter = new TranscriptMeter({
      dirs,
      read: fakeFiles().read,
      scheduler: { setTimeout: (_fn, ms) => scheduled.push(ms), clearTimeout: () => undefined },
      now: () => T0
    })
    meter.observe('s1', 'claude', 'Notification', { transcript_path: path })
    expect(scheduled).toEqual([])
    meter.observe('s1', 'claude', 'Stop', { transcript_path: path })
    expect(scheduled).toEqual([250, 1500])
  })
})
