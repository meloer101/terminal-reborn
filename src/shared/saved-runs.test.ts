import { describe, expect, it } from 'vitest'
import type { FixRun } from './auto-fix-brakes'
import type { PendingStart } from './dispatch'
import { GIT_FAILURE_KINDS } from './git-failures'
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

  it('keeps 合入链路 v2 runs (提交 / 同步 / 拉取), the merge method and a classified failure with its hand-off', () => {
    const failure = { kind: 'commit-hook', message: 'pre-commit hook 没通过', next: 'handoff', tail: 'lint failed' }
    const commit = {
      ...shipRun,
      kind: 'commit',
      ctx: { ...shipRun.ctx, method: 'rebase' },
      state: { ...shipState, kind: 'commit', error: { step: 'commit', message: 'pre-commit hook 没通过', failure, prompt: '提交时 hook 没通过' }, failedIn: 'running' }
    }
    const sync = { ...shipRun, kind: 'sync', state: { ...shipState, kind: 'sync', steps: [{ id: 'sync', label: '拉取 main', state: 'done' }] } }
    const pull = { ...shipRun, kind: 'pull', state: { ...shipState, kind: 'pull', steps: [{ id: 'sync', label: '拉取 origin/feat', state: 'working' }] } }
    expect(sanitizeShipRuns([commit], worktrees)).toEqual([commit])
    expect(sanitizeShipRuns([sync], worktrees)).toEqual([sync])
    expect(sanitizeShipRuns([pull], worktrees)).toEqual([pull])
    // An unknown method is dropped, the run kept. L10: so is a failure that does not validate (a newer build's): the run
    // keeps its commit, message and step.
    expect(sanitizeShipRuns([{ ...shipRun, ctx: { ...shipRun.ctx, method: 'octopus' } }], worktrees)).toEqual([shipRun])
    const newer = { ...commit, commit: 'abc1234', state: { ...commit.state, error: { ...commit.state.error, failure: { ...failure, next: 'deploy' } } } }
    const { failure: _dropped, ...withoutFailure } = commit.state.error
    expect(sanitizeShipRuns([newer], worktrees)).toEqual([{ ...newer, state: { ...commit.state, error: withoutFailure } }])
  })

  // Review findings 15 / 16: the tip a run started from and the commit it made come back; anything else is dropped.
  it('keeps the start tip and the run’s commit when they are hashes', () => {
    const run = { ...shipRun, commit: 'abc1234', ctx: { ...shipRun.ctx, head: '0123456789abcdef0123456789abcdef01234567' } }
    expect(sanitizeShipRuns([run], worktrees)).toEqual([run])
    expect(sanitizeShipRuns([{ ...shipRun, ctx: { ...shipRun.ctx, head: 'HEAD~1' } }], worktrees)).toEqual([shipRun])
    expect(sanitizeShipRuns([{ ...shipRun, commit: 'not a hash' }], worktrees)).toEqual([])
  })

  // Review finding 45: every failure kind git-failures.ts classifies comes back (identity was missing from a copy).
  it('keeps a failure of every kind git-failures.ts knows', () => {
    for (const kind of GIT_FAILURE_KINDS) {
      const failure = { kind, message: 'm', next: null, tail: '' }
      const run = { ...shipRun, state: { ...shipState, error: { step: 'commit', message: 'm', failure }, failedIn: 'running' } }
      expect(sanitizeShipRuns([run], worktrees)).toEqual([run])
    }
    expect(GIT_FAILURE_KINDS).toContain('identity')
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

  it('keeps a waiting child’s GUI 界面 and nothing else in its place (PRD F21 v1.163)', () => {
    const gui = { ...pending, plan: { ...pending.plan, item: { ...pending.plan.item, ui: 'gui' as const } } }
    expect(sanitizeSavedDispatch({ confirms: [gui] }, sessions)?.confirms).toEqual([gui])
    const odd = { ...pending, plan: { ...pending.plan, item: { ...pending.plan.item, ui: 'tui' } } }
    expect(sanitizeSavedDispatch({ confirms: [odd] }, sessions)?.confirms).toEqual([pending])
  })

  it('is nothing when nothing is left', () => {
    expect(sanitizeSavedDispatch({ confirms: [{ ...pending, parentId: 'gone' }], queues: {}, held: {} }, sessions)).toBeNull()
    expect(sanitizeSavedDispatch(42, sessions)).toBeNull()
    expect(sanitizeSavedDispatch({ confirms: [{ ...pending, plan: { ...pending.plan, request: { root: 'x' } } }] }, sessions)).toBeNull()
  })
})
