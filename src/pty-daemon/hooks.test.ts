import { describe, expect, it } from 'vitest'
import { HookJournal, JOURNAL_LIMIT, JOURNAL_PAYLOAD_MAX_CHARS } from './hooks'

const entry = (event: string, payload: unknown = { n: 1 }) => ({ event, agent: 'claude' as const, payload, at: 1 })

describe('HookJournal', () => {
  it('hands the missed events over oldest first, once', () => {
    const journal = new HookJournal()
    journal.record('s1', entry('UserPromptSubmit'))
    journal.record('s1', entry('Stop'))
    journal.record('s2', entry('SessionStart'))
    expect(journal.take('s1').map((e) => e.event)).toEqual(['UserPromptSubmit', 'Stop'])
    expect(journal.take('s1')).toEqual([])
    expect(journal.take('s2')).toHaveLength(1)
  })

  it('keeps only the latest events of a long absence', () => {
    const journal = new HookJournal()
    for (let i = 0; i < JOURNAL_LIMIT + 10; i++) journal.record('s1', entry(`E${i}`))
    const taken = journal.take('s1')
    expect(taken).toHaveLength(JOURNAL_LIMIT)
    expect(taken[0]?.event).toBe('E10')
  })

  it('keeps only the newest statusLine reading', () => {
    const journal = new HookJournal()
    journal.record('s1', entry('StatusLine', { n: 1 }))
    journal.record('s1', entry('PostToolUse'))
    journal.record('s1', entry('StatusLine', { n: 2 }))
    expect(journal.take('s1').map((e) => [e.event, e.payload])).toEqual([
      ['PostToolUse', { n: 1 }],
      ['StatusLine', { n: 2 }]
    ])
  })

  it('drops large payloads but keeps the event', () => {
    const journal = new HookJournal()
    journal.record('s1', entry('PostToolUse', { output: 'x'.repeat(JOURNAL_PAYLOAD_MAX_CHARS) }))
    expect(journal.take('s1')).toEqual([{ event: 'PostToolUse', agent: 'claude', payload: null, at: 1 }])
  })

  it('forgets sessions that are gone', () => {
    const journal = new HookJournal()
    journal.record('s1', entry('Stop'))
    journal.record('s2', entry('Stop'))
    journal.retain(new Set(['s2']))
    expect(journal.take('s1')).toEqual([])
    expect(journal.take('s2')).toHaveLength(1)
  })
})
