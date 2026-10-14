import { describe, expect, it } from 'vitest'
import type { PendingPrompt } from '@shared/agent-events'
import { addPrompt, keepSessions, NO_PROMPTS, removePrompt, removeSessionPrompts, type PromptsBySession } from './model'

const permission = (id: string, sessionId = 's1'): Extract<PendingPrompt, { kind: 'permission' }> => ({
  kind: 'permission',
  id,
  sessionId,
  tool: 'Bash',
  input: { command: 'ls' },
  summary: '运行 ls',
  canAllowAlways: true,
  createdAt: 1
})
const question = (id: string, sessionId = 's1'): PendingPrompt => ({
  kind: 'question',
  id,
  sessionId,
  questions: [{ question: 'q', multiSelect: false, options: [{ label: 'a' }] }],
  createdAt: 1
})
const ids = (state: PromptsBySession, sessionId = 's1') => (state[sessionId] ?? NO_PROMPTS).map((p) => p.id)

describe('prompt queue', () => {
  it('is FIFO per session and sessions are independent', () => {
    let s: PromptsBySession = {}
    s = addPrompt(s, permission('a'))
    s = addPrompt(s, permission('b'))
    s = addPrompt(s, permission('c', 's2'))
    expect(ids(s)).toEqual(['a', 'b'])
    expect(ids(s, 's2')).toEqual(['c'])
  })

  it('the same id replaces in place', () => {
    let s: PromptsBySession = addPrompt(addPrompt({}, permission('a')), permission('b'))
    s = addPrompt(s, { ...permission('a'), summary: '运行 pwd' })
    expect(ids(s)).toEqual(['a', 'b'])
    expect(s['s1']?.[0]).toMatchObject({ summary: '运行 pwd' })
  })

  it('a new question replaces a stale queued question and keeps its position', () => {
    let s: PromptsBySession = addPrompt({}, permission('p1'))
    s = addPrompt(s, question('q1'))
    s = addPrompt(s, permission('p2'))
    s = addPrompt(s, question('q2'))
    expect(ids(s)).toEqual(['p1', 'q2', 'p2'])
  })

  it('removes by id and drops empty queues', () => {
    let s: PromptsBySession = addPrompt(addPrompt({}, permission('a')), permission('b'))
    s = removePrompt(s, 'a')
    expect(ids(s)).toEqual(['b'])
    s = removePrompt(s, 'b')
    expect(s).toEqual({})
    expect(removePrompt(s, 'nope')).toBe(s)
  })

  it('removes a closed session and keeps only live sessions', () => {
    let s: PromptsBySession = addPrompt(addPrompt({}, permission('a')), permission('c', 's2'))
    expect(ids(removeSessionPrompts(s, 's1'))).toEqual([])
    expect(removeSessionPrompts(s, 'zzz')).toBe(s)
    s = keepSessions(s, new Set(['s2']))
    expect(Object.keys(s)).toEqual(['s2'])
  })
})
