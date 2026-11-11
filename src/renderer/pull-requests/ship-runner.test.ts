// 合并到 main 并推送 (exit A) driven against a fake window.tr: what a retry after a failed push asks main to do.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { ShipMainResult } from '@shared/ship'
import { failureWay } from './ship-flow'

vi.mock('../lifecycle/agent-up', () => ({ ensureAgentUp: async () => true }))
vi.mock('../review/background', () => ({
  cancelBackgroundReview: () => {},
  startBackgroundReview: async () => {},
  useBackgroundReview: { getState: () => ({ byRoot: {} }) }
}))
vi.mock('../session-io', () => ({ insertIntoTerminal: () => {}, submitPrompt: () => {} }))
vi.mock('../state/workspace', () => ({ useWorkspace: { getState: () => ({ sessions: [] }) } }))
vi.mock('./actions', () => ({ openPullRequest: () => {} }))
const setPrNotice = vi.fn()
vi.mock('./store', () => ({ setPrNotice: (...args: unknown[]) => setPrNotice(...args) }))

const { cancelShip, editShip, handoffText, restoreShipRuns, retryShip, savedShipRuns, startShip, submitShip, useShips } = await import('./ship-runner')

const shipToMain = vi.fn<(request: unknown) => Promise<ShipMainResult>>()
const commit = vi.fn<(request: unknown) => Promise<unknown>>()
const sync = vi.fn<(request: unknown) => Promise<unknown>>()
const pull = vi.fn<(request: unknown) => Promise<unknown>>()
const detectAgents = vi.fn<() => Promise<Record<string, boolean>>>()
const pushBase = vi.fn<(target: unknown) => Promise<ShipMainResult>>()
const preflight = vi.fn<(target: unknown) => Promise<unknown>>()

const ctx = {
  root: '/repo',
  worktree: '/repo-wt',
  sessionId: null,
  base: 'main',
  branch: 'feat',
  remote: 'origin',
  paths: ['new.txt'],
  openPr: null,
  checksLine: null,
  settings: { review: { ...DEFAULT_SETTINGS.review, beforeMerge: false, beforePush: false }, pr: DEFAULT_SETTINGS.pr },
  openIn: null
}

const state = () => useShips.getState().byWorktree[ctx.worktree]!
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
}

async function shipUntilPushFails(failed: ShipMainResult): Promise<void> {
  shipToMain.mockResolvedValueOnce(failed)
  startShip(ctx, 'main', 'feat: new')
  await settle()
  expect(state().stage).toBe('glance')
  submitShip(ctx.worktree)
  await settle()
}

beforeEach(() => {
  cancelShip(ctx.worktree)
  useShips.setState({ byWorktree: {} })
  shipToMain.mockReset()
  pushBase.mockReset()
  preflight.mockReset()
  commit.mockReset()
  sync.mockReset()
  pull.mockReset()
  detectAgents.mockReset()
  detectAgents.mockResolvedValue({ claude: true, codex: true })
  setPrNotice.mockReset()
  preflight.mockResolvedValue({ ok: true, merged: false, uncommitted: 1 })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  vi.stubGlobal('window', {
    tr: {
      pr: { write: async () => ({ ok: true, kind: 'commit', agent: 'claude', message: 'feat: new' }), cancelWrite: () => {}, refresh: async () => {}, commit },
      ship: { shipToMain, pushBase, preflight, sync, pull },
      app: { detectAgents },
      ui: { notify: () => {} }
    }
  })
})

describe('合并到 main 并推送 after its push failed', () => {
  it('retries the push alone: the merge it kept is not run again', async () => {
    await shipUntilPushFails({ ok: true, commit: 'c1', pushed: false, pushError: '推送到 origin 失败（合并已留在本地 main 上）：offline' })
    expect(state().error).toMatchObject({ step: 'push' })
    // A network error is not a protected branch: no 改为创建 PR.
    expect(state().error).not.toHaveProperty('pushRefused')

    pushBase.mockResolvedValueOnce({ ok: true, commit: 'c1', pushed: true })
    retryShip(ctx.worktree)
    await settle()
    expect(shipToMain).toHaveBeenCalledTimes(1)
    expect(pushBase).toHaveBeenCalledWith({ root: '/repo', worktree: '/repo-wt', commit: 'c1' })
    // Done: the block goes and the notice says what happened.
    expect(useShips.getState().byWorktree[ctx.worktree]).toBeUndefined()
    expect(setPrNotice).toHaveBeenLastCalledWith('/repo-wt', { tone: 'muted', text: '已合并到 main 并推送 · c1' })
  })

  it('merges with the method the run was started with', async () => {
    shipToMain.mockResolvedValueOnce({ ok: true, commit: 'c1', pushed: true })
    startShip({ ...ctx, method: 'merge' }, 'main', 'feat: new')
    await settle()
    expect(state().steps.find((s) => s.id === 'merge')?.label).toBe('合并到 main · Merge')
    submitShip(ctx.worktree)
    await settle()
    expect(shipToMain).toHaveBeenCalledWith(expect.objectContaining({ method: 'merge' }))
  })

  it('a push of the base refused by a remote that moved shows git’s words in plain language and offers only 取消', async () => {
    // 同步 cannot repair a local base that diverged from its remote, and 重试 would be refused the same way.
    const failure = { kind: 'non-fast-forward' as const, message: '远程有本地没有的提交', next: null, tail: '! [rejected] main -> main (fetch first)' }
    await shipUntilPushFails({ ok: true, commit: 'c1', pushed: false, pushError: '推送到 origin 失败', failure })
    expect(state().error).toMatchObject({ step: 'push', message: '远程有本地没有的提交', failure })
    expect(failureWay(state().error!)).toBeNull()
    expect(state().steps.map((s) => [s.id, s.state])).toEqual([
      ['write', 'done'],
      ['commit', 'done'],
      ['merge', 'done'],
      ['push', 'failed']
    ])
  })

  it('a commit hook that failed keeps its output and has the hand-off ready (Figma 73E3)', async () => {
    const failure = { kind: 'commit-hook' as const, message: 'pre-commit hook 没通过', next: 'handoff' as const, tail: 'eslint: 1 error' }
    await shipUntilPushFails({ ok: false, step: 'commit', reason: 'failed', message: '提交失败', output: 'eslint: 1 error', failure })
    expect(state().error).toMatchObject({ step: 'commit', message: 'pre-commit hook 没通过', output: 'eslint: 1 error' })
    expect(state().error!.prompt).toContain('Wavi 运行「提交」时失败了：pre-commit hook 没通过。')
    expect(state().error!.prompt).toContain('eslint: 1 error')
  })

  it('offers 改为创建 PR when main says the base is protected', async () => {
    await shipUntilPushFails({ ok: true, commit: 'c1', pushed: false, pushError: 'main 受保护', pushRefused: true })
    expect(state().error).toMatchObject({ step: 'push', pushRefused: true })
  })

  it('stays on the push step when the retried push fails too', async () => {
    await shipUntilPushFails({ ok: true, commit: 'c1', pushed: false, pushError: '推送到 origin 失败：offline' })
    pushBase.mockResolvedValueOnce({ ok: false, step: 'push', reason: 'failed', message: 'main 上已经没有这次的合并（c1）：没有推送' })
    retryShip(ctx.worktree)
    await settle()
    expect(state().error).toMatchObject({ step: 'push', message: 'main 上已经没有这次的合并（c1）：没有推送' })
    expect(shipToMain).toHaveBeenCalledTimes(1)
  })

  it('does not commit the ticked files twice when main says they went in before the step that failed', async () => {
    await shipUntilPushFails({ ok: false, step: 'merge', reason: 'conflicts', message: '1 个文件和 main 冲突', conflicts: ['a.txt'], committed: true })
    shipToMain.mockResolvedValueOnce({ ok: true, commit: 'c2', pushed: true })
    retryShip(ctx.worktree)
    await settle()
    expect(shipToMain).toHaveBeenLastCalledWith(expect.objectContaining({ paths: null }))
  })

  it('commits the ticked files again on a retry when main says they were not committed', async () => {
    await shipUntilPushFails({ ok: false, step: 'merge', reason: 'blocked', message: '正在合并这个分支' })
    shipToMain.mockResolvedValueOnce({ ok: true, commit: 'c2', pushed: true })
    retryShip(ctx.worktree)
    await settle()
    expect(shipToMain).toHaveBeenLastCalledWith(expect.objectContaining({ paths: ['new.txt'] }))
  })
})

describe('a Ship block across a reload (architecture review, batch 6)', () => {
  it('is saved without the settings, and comes back with the step under way failed, ready for 重试', async () => {
    shipToMain.mockReturnValueOnce(new Promise(() => {}))
    startShip(ctx, 'main', 'feat: new')
    await settle()
    submitShip(ctx.worktree)
    await settle()
    const [saved] = savedShipRuns()
    expect(saved).toMatchObject({ kind: 'main', committed: false, ctx: { root: '/repo', worktree: '/repo-wt', paths: ['new.txt'] } })
    expect(saved!.ctx).not.toHaveProperty('settings')
    // The ticked files are committed inside main's merge call: 提交 is the step under way (Figma 73E).
    expect(saved!.state.steps.find((s) => s.id === 'commit')?.state).toBe('working')

    // A new window.
    cancelShip(ctx.worktree)
    restoreShipRuns([saved!], ctx.settings)
    expect(state().error).toEqual({ step: 'commit', message: '窗口重新加载时这一步还没有结果，点重试' })
    shipToMain.mockResolvedValueOnce({ ok: true, commit: 'c3', pushed: true })
    retryShip(ctx.worktree)
    await settle()
    expect(shipToMain).toHaveBeenLastCalledWith(expect.objectContaining({ paths: ['new.txt'], message: 'feat: new' }))
    expect(setPrNotice).toHaveBeenLastCalledWith('/repo-wt', { tone: 'muted', text: '已合并到 main 并推送 · c3' })
  })

  it('asks main first: a merge it finished after the old window went is not run again, only the push', async () => {
    shipToMain.mockReturnValueOnce(new Promise(() => {}))
    startShip(ctx, 'main', 'feat: new')
    await settle()
    submitShip(ctx.worktree)
    await settle()
    const [saved] = savedShipRuns()
    cancelShip(ctx.worktree)
    restoreShipRuns([saved!], ctx.settings)
    preflight.mockResolvedValueOnce({ ok: true, merged: true, uncommitted: 0 })
    pushBase.mockResolvedValueOnce({ ok: true, commit: 'c9', pushed: true })
    retryShip(ctx.worktree)
    await settle()
    expect(shipToMain).toHaveBeenCalledTimes(1)
    expect(pushBase).toHaveBeenCalledWith({ root: '/repo', worktree: '/repo-wt' })
    expect(setPrNotice).toHaveBeenLastCalledWith('/repo-wt', { tone: 'muted', text: '已合并到 main 并推送 · c9' })
  })

  it('keeps the kept merge across it, so 重试 after a failed push still pushes the base alone', async () => {
    await shipUntilPushFails({ ok: true, commit: 'c1', pushed: false, pushError: '推送到 origin 失败：offline' })
    const [saved] = savedShipRuns()
    expect(saved).toMatchObject({ merged: 'c1' })
    cancelShip(ctx.worktree)
    restoreShipRuns([saved!], ctx.settings)
    pushBase.mockResolvedValueOnce({ ok: true, commit: 'c1', pushed: true })
    retryShip(ctx.worktree)
    await settle()
    expect(pushBase).toHaveBeenCalledWith({ root: '/repo', worktree: '/repo-wt', commit: 'c1' })
  })
})

describe('合入链路 v2 runs', () => {
  const commitCtx = { ...ctx, paths: ['a.txt', 'b.txt'] }

  it('提交…: the headless writer writes, the user looks, Wavi commits the ticked files; not remembered as an exit', async () => {
    commit.mockResolvedValueOnce({ ok: true, commit: 'abc1234def', subject: 'feat: new' })
    startShip(commitCtx, 'commit', '提交 2 个文件')
    await settle()
    expect(state()).toMatchObject({ stage: 'glance', texts: { commit: 'feat: new' } })
    submitShip(ctx.worktree)
    await settle()
    expect(commit).toHaveBeenCalledWith({ root: '/repo', worktree: '/repo-wt', message: 'feat: new', paths: ['a.txt', 'b.txt'] })
    expect(useShips.getState().byWorktree[ctx.worktree]).toBeUndefined()
    expect(setPrNotice).toHaveBeenLastCalledWith('/repo-wt', { tone: 'muted', text: '已提交 · abc1234' })
  })

  it('提交… with no writer installed opens on the empty field; a typed message commits', async () => {
    detectAgents.mockResolvedValue({ claude: false, codex: false })
    commit.mockResolvedValueOnce({ ok: true, commit: 'abc1234def', subject: 'typed' })
    startShip(commitCtx, 'commit', '提交 2 个文件')
    await settle()
    expect(state().steps.map((s) => s.id)).toEqual(['commit'])
    expect(state()).toMatchObject({ stage: 'glance', texts: { commit: '' } })
    editShip(ctx.worktree, { commit: 'typed' })
    submitShip(ctx.worktree)
    await settle()
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ message: 'typed' }))
  })

  it('同步 main: both steps done, the base’s note kept', async () => {
    sync.mockResolvedValueOnce({ ok: true, baseNotCaughtUp: 'main 有未提交的改动，没有快进' })
    startShip({ ...ctx, paths: null }, 'sync', '同步 main', { syncMode: 'rebase' })
    await settle()
    expect(useShips.getState().byWorktree[ctx.worktree]).toBeUndefined()
    expect(setPrNotice).toHaveBeenLastCalledWith('/repo-wt', { tone: 'muted', text: '已同步 main' })
  })

  it('同步 main that would conflict starts nothing and has the rebase hand-off ready (Figma 73D2)', async () => {
    sync.mockResolvedValueOnce({ ok: false, reason: 'conflicts', files: ['src/store.ts'], mode: 'rebase', conflicts: [] })
    startShip({ ...ctx, paths: null }, 'sync', '同步 main', { syncMode: 'rebase', behind: 5 })
    await settle()
    expect(state().steps.map((s) => [s.id, s.state])).toEqual([
      ['sync', 'done'],
      ['merge', 'failed']
    ])
    expect(state().error).toMatchObject({ step: 'merge', message: 'rebase 会冲突 · store.ts', conflicts: ['src/store.ts'] })
    expect(state().error!.prompt).toContain('GIT_EDITOR=true git rebase main')
    expect(state().error!.prompt).toContain('落后 5 个提交')
    expect(handoffText(state().error, 'main')).toBe(state().error!.prompt)
  })

  it('拉取 of a diverged branch fails with the merge hand-off', async () => {
    pull.mockResolvedValueOnce({ ok: false, reason: 'failed', failure: { kind: 'diverged', message: '远程分支和本地分叉', next: 'handoff', tail: 'fatal: Not possible to fast-forward' } })
    startShip({ ...ctx, paths: null }, 'pull', '拉取')
    await settle()
    expect(state().error).toMatchObject({ step: 'sync', message: '远程分支和本地分叉' })
    expect(state().error!.prompt).toContain('git pull --no-rebase origin feat')
  })
})
