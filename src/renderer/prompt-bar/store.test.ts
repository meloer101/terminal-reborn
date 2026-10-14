import { beforeEach, describe, expect, it } from 'vitest'
import type { PendingPrompt } from '@shared/agent-events'
import { getPendingPrompts, selectPrompts, usePromptStore } from './store'

const q = (id: string, sessionId = 's1'): PendingPrompt => ({
  kind: 'question',
  id,
  sessionId,
  questions: [
    { question: 'a', multiSelect: false, options: [{ label: 'x' }] },
    { question: 'b', multiSelect: true, options: [{ label: 'y' }] }
  ],
  createdAt: 1
})
const p = (id: string, sessionId = 's1'): PendingPrompt => ({
  kind: 'permission',
  id,
  sessionId,
  tool: 'Bash',
  input: {},
  summary: '运行 ls',
  canAllowAlways: false,
  createdAt: 1
})

const store = () => usePromptStore.getState()

beforeEach(() => {
  usePromptStore.setState({ bySession: {}, questionProgress: {}, error: null })
})

describe('prompt store', () => {
  it('queues per session and resolves by id', () => {
    store().add(p('a'))
    store().add(p('b'))
    store().add(p('c', 's2'))
    expect(getPendingPrompts('s1').map((x) => x.id)).toEqual(['a', 'b'])
    store().resolve('a')
    expect(getPendingPrompts('s1').map((x) => x.id)).toEqual(['b'])
    expect(getPendingPrompts('s2')).toHaveLength(1)
  })

  it('the selector returns the same array while nothing changed', () => {
    store().add(p('a'))
    const first = selectPrompts('s1')(store())
    store().add(p('c', 's2'))
    expect(selectPrompts('s1')(store())).toBe(first)
    expect(selectPrompts('none')(store())).toBe(selectPrompts(null)(store()))
  })

  it('tracks question progress and forgets it on resolve', () => {
    store().add(q('q1'))
    store().advanceQuestion('q1')
    expect(store().questionProgress['q1']).toBe(1)
    store().resolve('q1')
    expect(store().questionProgress).toEqual({})
    expect(getPendingPrompts('s1')).toEqual([])
  })

  it('a re-asked question replaces the old one', () => {
    store().add(q('q1'))
    store().advanceQuestion('q1')
    store().add(q('q2'))
    expect(getPendingPrompts('s1').map((x) => x.id)).toEqual(['q2'])
  })

  it('closing a session clears its prompts and progress', () => {
    store().add(q('q1'))
    store().advanceQuestion('q1')
    store().add(p('c', 's2'))
    store().clearSession('s1')
    expect(getPendingPrompts('s1')).toEqual([])
    expect(store().questionProgress).toEqual({})
    expect(getPendingPrompts('s2')).toHaveLength(1)
    store().keepSessions(new Set())
    expect(getPendingPrompts('s2')).toEqual([])
  })

  it('restore puts the prompt back at the failed question with an error', () => {
    const prompt = q('q1')
    store().resolve('q1')
    store().restore(prompt, 1, '终端没有响应')
    expect(getPendingPrompts('s1')).toEqual([prompt])
    expect(store().questionProgress['q1']).toBe(1)
    expect(store().error).toEqual({ promptId: 'q1', message: '终端没有响应' })
    store().clearError()
    expect(store().error).toBeNull()
  })
})
