import { describe, expect, it } from 'vitest'
import type { FixRun } from './auto-fix-brakes'
import type { PendingStart } from './dispatch'
import { sanitizeFixRuns, sanitizeSavedDispatch, sanitizeShipRuns, type SavedShipRun } from './saved-runs'
import type { ShipState } from './ship'

const worktrees = new Set(['/code/acme', '/code/acme-wt'])
const sessions = new Set(['s1', 's2'])

const fixing: FixRun = { kind: 'fixing', sessionId: 's1', key: 'k', checks: ['test'], baseFailing: null, since: 'abc1234', sentAt: 5 }

describe('sanitizeFixRuns', () => {
  it('keeps unfinished runs of worktrees that exist', () => {
    const runs = [
      { scope: 'pr', worktree: '/code/acme-wt', number: 7, run: fixing },
      { scope: 'base', worktree: '/code/acme', number: 0, run: { ...fixing, kind: 'pushing' } },
      { scope: 'pr', worktree: '/code/gone', number: 7, run: fixing }
    ]
    expect(sanitizeFixRuns(runs, worktrees).map((r) => [r.scope, r.worktree, r.run.kind])).toEqual([
      ['pr', '/code/acme-wt', 'fixing'],
      ['base', '/code/acme', 'pushing']
    ])
  })

  it('keeps a stopped run with what it stopped on, and drops what it cannot trust', () => {
    const stopped = { ...fixing, kind: 'stopped', decision: { kind: 'stop', reason: 'repeated' } }
    expect(sanitizeFixRuns([{ scope: 'pr', worktree: '/code/acme', number: 1, run: stopped }], worktrees)[0]?.run).toEqual({ ...stopped, sentAt: undefined })
    const bad = [
      { scope: 'pr', worktree: '/code/acme', number: 1, run: { ...fixing, kind: 'sent' } },
      { scope: 'pr', worktree: '/code/acme', number: 1, run: { ...fixing, since: 'HEAD~1' } },
      { scope: 'elsewhere', worktree: '/code/acme', number: 1, run: fixing },
      { scope: 'pr', worktree: '/code/acme', number: -1, run: fixing },
      { scope: 'pr', worktree: '/code/acme', number: 1, run: { ...fixing, kind: 'stopped', decision: { kind: 'stop', reason: 'bored' } } }
    ]
    expect(sanitizeFixRuns(bad, worktrees)).toEqual([])
    expect(sanitizeFixRuns('nope', worktrees)).toEqual([])
  })
})

const shipState: ShipState = {
  kind: 'main',
  title: '合并到 main 并推送',
  agent: 'Claude',
  steps: [
    { id: 'write', label: 'Claude 写提交说明', state: 'done' },
    { id: 'merge', label: '合并到 main · Squash', state: 'working' },
    { id: 'push', label: '推送 origin/main', state: 'pending' }
  ],
  stage: 'running',
  texts: { commit: 'feat: x', title: '', body: '', draft: false },
  error: null,
  failedIn: null
}
const shipRun: SavedShipRun = {
  kind: 'main',
  committed: false,
  ctx: {
    root: '/code/acme',
    worktree: '/code/acme-wt',
    sessionId: 's1',
    base: 'main',
    branch: 'feat',
    remote: 'origin',
    paths: ['a.txt'],
    openPr: null,
    checksLine: null,
    openIn: null
  },
  state: shipState
}

describe('sanitizeShipRuns', () => {
  it('keeps a run of a worktree that exists, as it was', () => {
    expect(sanitizeShipRuns([shipRun, { ...shipRun, ctx: { ...shipRun.ctx, worktree: '/code/gone' } }], worktrees)).toEqual([shipRun])
    const failed = { ...shipRun, merged: 'abc1234', state: { ...shipState, error: { step: 'push', message: 'offline', pushRefused: true }, failedIn: 'running' } }
    expect(sanitizeShipRuns([failed], worktrees)).toEqual([failed])
  })

  it('drops a run whose state is not one the block can draw', () => {
    const bad = [
      { ...shipRun, kind: 'deploy' },
      { ...shipRun, state: { ...shipState, stage: 'later' } },
      { ...shipRun, state: { ...shipState, steps: [{ id: 'merge', label: 'x', state: 'maybe' }] } },
      { ...shipRun, ctx: { ...shipRun.ctx, root: 'relative' } },
      { ...shipRun, ctx: { ...shipRun.ctx, paths: ['../etc/passwd'] } }
    ]
    expect(sanitizeShipRuns(bad, worktrees)).toEqual([])
  })
})

const pending: PendingStart = {
  callId: 'c1',
  parentId: 's1',
  childId: 'child-1',
  base: 'feat',
  uncommitted: false,
  plan: {
    item: { agent: 'codex', task: 'write the tests', title: 'tests', base: 'head' },
    branch: 'jacob/tests',
    path: '/code/acme-wt-tests',
    request: { root: '/code/acme', folder: 'acme-wt-tests', branch: 'jacob/tests', base: 'feat', prepare: false }
  }
}

describe('sanitizeSavedDispatch', () => {
  it('keeps what waits for the user and the reports on their way, for sessions that exist', () => {
    const report = { childId: 's2', title: 'tests', agent: 'codex', event: 'done', branch: 'jacob/tests', turn: 3 }
    const saved = {
      confirms: [pending, { ...pending, callId: 'c2', parentId: 'gone' }],
      queues: { s1: { pending: [report], lastAt: 10, sent: [1, 2], seen: ['s2:3:done'] }, gone: { pending: [], lastAt: null, sent: [], seen: [] } },
      held: { s1: [{ kind: 'report', report }, { kind: 'message', key: 'm', title: 't', text: 'hi' }] }
    }
    expect(sanitizeSavedDispatch(saved, sessions)).toEqual({
      confirms: [pending],
      queues: { s1: saved.queues.s1 },
      held: saved.held
    })
  })

  it('is nothing when nothing is left', () => {
    expect(sanitizeSavedDispatch({ confirms: [{ ...pending, parentId: 'gone' }], queues: {}, held: {} }, sessions)).toBeNull()
    expect(sanitizeSavedDispatch(42, sessions)).toBeNull()
    expect(sanitizeSavedDispatch({ confirms: [{ ...pending, plan: { ...pending.plan, request: { root: 'x' } } }] }, sessions)).toBeNull()
  })
})
