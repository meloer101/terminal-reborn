// 合并到 main 并推送 (exit A) driven against a fake window.tr: what a retry after a failed push asks main to do.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { ShipMainResult } from '@shared/ship'

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

const { cancelShip, restoreShipRuns, retryShip, savedShipRuns, startShip, submitShip, useShips } = await import('./ship-runner')

const shipToMain = vi.fn<(request: unknown) => Promise<ShipMainResult>>()
const pushBase = vi.fn<(target: unknown) => Promise<ShipMainResult>>()

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
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  vi.stubGlobal('window', {
    tr: {
      pr: { write: async () => ({ ok: true, kind: 'commit', agent: 'claude', message: 'feat: new' }), cancelWrite: () => {}, refresh: async () => {} },
      ship: { shipToMain, pushBase },
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
    expect(saved!.state.steps.find((s) => s.id === 'merge')?.state).toBe('working')

    // A new window.
    cancelShip(ctx.worktree)
    restoreShipRuns([saved!], ctx.settings)
    expect(state().error).toEqual({ step: 'merge', message: '窗口重新加载时这一步还没有结果，点重试' })
    shipToMain.mockResolvedValueOnce({ ok: true, commit: 'c3', pushed: true })
    retryShip(ctx.worktree)
    await settle()
    expect(shipToMain).toHaveBeenLastCalledWith(expect.objectContaining({ paths: ['new.txt'], message: 'feat: new' }))
    expect(setPrNotice).toHaveBeenLastCalledWith('/repo-wt', { tone: 'muted', text: '已合并到 main 并推送 · c3' })
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
