import { describe, expect, it } from 'vitest'
import type { PendingStart } from '@shared/dispatch'
import type { Session } from '@shared/types'
import { dispatcherChildIds, dispatchView, stripShown, undrawnWaiting, type DispatchInput } from './view'

const T0 = 1_000_000

function session(over: Partial<Session> & Pick<Session, 'id'>): Session {
  return { worktreeId: 'w', kind: 'codex', title: over.id, status: 'running', startedAt: T0, lastActivityAt: T0, dispatchedBy: 'p', ...over }
}

function pending(childId: string, over: Partial<PendingStart['plan']['item']> = {}): PendingStart {
  return {
    callId: `c-${childId}`,
    parentId: 'p',
    childId,
    plan: { item: { agent: 'gemini', task: 'Drop localStorage\nall of it', title: 'Drop', base: 'head', model: 'gemini-3-pro', ...over }, branch: 'jacob/drop', path: '/w/drop', request: {} as never },
    base: 'main',
    uncommitted: false
  }
}

const input = (over: Partial<DispatchInput>): DispatchInput => ({ ids: [], sessions: [], confirms: [], changes: {}, reported: new Set(), ...over })

describe('dispatchView (Figma 68′)', () => {
  it('draws each child in the order the answers named them, its own children under it', () => {
    const view = dispatchView(
      input({
        ids: ['a', 'b'],
        sessions: [
          session({ id: 'b', kind: 'claude', title: 'Refresh', status: 'running', currentAction: '编辑 src/auth/refresh.ts', turnStartedAt: T0 + 5 }),
          session({ id: 'a', title: 'Tests', status: 'done_unread', finishedAt: T0 + 192_000, dispatchModel: 'gpt-6-sol' }),
          session({ id: 'g', title: 'Review', dispatchedBy: 'b', status: 'running' }),
          session({ id: 'x', title: 'Not this call', status: 'running' })
        ],
        changes: { a: '+84 −3 · 2 个文件' },
        reported: new Set(['a'])
      })
    )
    expect(view.nodes.map((n) => [n.id, n.state, n.children.map((c) => c.id)])).toEqual([
      ['a', 'done', []],
      ['b', 'working', ['g']]
    ])
    expect(view.nodes[0]).toMatchObject({ agent: 'codex', model: 'gpt-6-sol', changes: '+84 −3 · 2 个文件', reported: true, since: T0, until: T0 + 192_000 })
    expect(view.nodes[1]).toMatchObject({ action: '编辑 src/auth/refresh.ts', since: T0 + 5 })
    expect(view.counts).toEqual({ working: 2, done: 1 })
    expect(view.reports).toBe(1)
    expect(view.settled).toBe(false)
  })

  it('shows a request still waiting for 开始 from what wavi run asked for', () => {
    const view = dispatchView(input({ ids: ['w'], confirms: [pending('w'), pending('other-parent-or-call')] }))
    expect(view.nodes).toEqual([{ id: 'w', agent: 'gemini', title: 'Drop', model: 'gemini-3-pro', task: 'Drop localStorage', state: 'pending', children: [], reported: false }])
    expect(view.waiting.map((c) => c.childId)).toEqual(['w'])
  })

  it('names what needs the user first: an error, then a question; a session gone from the workspace is drawn as exited', () => {
    const view = dispatchView(
      input({
        ids: ['a', 'b', 'c', 'gone'],
        sessions: [session({ id: 'a', status: 'needs_you', statusSince: T0 }), session({ id: 'b', status: 'error' }), session({ id: 'c', status: 'idle', phase: 'exited' })]
      })
    )
    expect(view.nodes.map((n) => n.state)).toEqual(['attention', 'error', 'exited', 'exited'])
    expect(view.nodes[3]).toMatchObject({ title: '', gone: true })
    expect(view.urgent?.id).toBe('b')
    expect(view.settled).toBe(false)
  })

  it('names a request the user turned down by what the notice said, not as a session gone', () => {
    const view = dispatchView(input({ ids: ['d'], outcomes: new Map([['d', { outcome: 'declined' as const, title: 'Drop' }]]) }))
    expect(view.nodes[0]).toMatchObject({ title: 'Drop', state: 'exited', declined: 'declined' })
    expect(view.nodes[0]?.gone).toBeUndefined()
  })

  it('is settled once every session finished or went away, at the last finish', () => {
    const view = dispatchView(
      input({ ids: ['a', 'b'], sessions: [session({ id: 'a', status: 'idle', finishedAt: T0 + 10 }), session({ id: 'b', status: 'exited', finishedAt: T0 + 30 })] })
    )
    expect(view).toMatchObject({ settled: true, settledAt: T0 + 30, urgent: null })
  })
})

describe('stripShown', () => {
  const live = dispatchView(input({ ids: ['a'], sessions: [session({ id: 'a' })] }))
  const done = dispatchView(input({ ids: ['a'], sessions: [session({ id: 'a', status: 'idle', finishedAt: T0 + 10 })] }))
  it('shows while anything runs, and after the end until the dispatcher’s next message', () => {
    expect(stripShown(live, null)).toBe(true)
    expect(stripShown(done, T0)).toBe(true)
    expect(stripShown(done, T0 + 20)).toBe(false)
    expect(stripShown(dispatchView(input({})), null)).toBe(false)
  })
})

describe('the strip’s sessions', () => {
  it('lists a dispatcher’s children by start, then its requests still waiting', () => {
    const sessions = [session({ id: 'b', startedAt: 2 }), session({ id: 'a', startedAt: 1 }), session({ id: 'x', dispatchedBy: 'other' })]
    expect(dispatcherChildIds('p', sessions, [pending('w'), { ...pending('z'), parentId: 'other' }])).toEqual(['a', 'b', 'w'])
  })
  it('finds the waiting requests no graph in the chat draws, so they can still be answered', () => {
    expect(undrawnWaiting('p', [pending('w'), pending('v'), { ...pending('z'), parentId: 'other' }], new Set(['w'])).map((c) => c.childId)).toEqual(['v'])
  })
})
