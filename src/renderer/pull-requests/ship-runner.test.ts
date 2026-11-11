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
const submitted: Array<{ id: string; text: string }> = []
const inserted: Array<{ id: string; text: string }> = []
vi.mock('../session-io', () => ({
  insertIntoTerminal: async (id: string, text: string) => void inserted.push({ id, text }),
  submitPrompt: async (id: string, text: string) => void submitted.push({ id, text })
}))
type FakeSession = { id: string; kind: string; status: string; worktreeId: string }
const workspace: { sessions: FakeSession[]; activeSessionId: string | null } = { sessions: [], activeSessionId: null }
vi.mock('../state/workspace', () => ({
  useWorkspace: {
    getState: () => ({
      ...workspace,
      setActiveSession: (id: string) => {
        workspace.activeSessionId = id
      },
      requestTerminalFocus: () => {}
    }),
    subscribe: () => () => {}
  }
}))
vi.mock('./actions', () => ({ openPullRequest: () => {} }))
const setPrNotice = vi.fn()
vi.mock('./store', () => ({ setPrNotice: (...args: unknown[]) => setPrNotice(...args) }))

const { cancelShip, editShip, handConflictsToAgent, handoffText, restoreShipRuns, retryShip, savedShipRuns, shipCanRetry, shipFinished, shipHandoffSession, startShip, submitShip, useShips } = await import('./ship-runner')

const shipToMain = vi.fn<(request: unknown) => Promise<ShipMainResult>>()
const commit = vi.fn<(request: unknown) => Promise<unknown>>()
const sync = vi.fn<(request: unknown) => Promise<unknown>>()
const pull = vi.fn<(request: unknown) => Promise<unknown>>()
const detectAgents = vi.fn<() => Promise<Record<string, boolean>>>()
const pushBase = vi.fn<(target: unknown) => Promise<ShipMainResult>>()
const preflight = vi.fn<(target: unknown) => Promise<unknown>>()
const readHandoff = vi.fn<(request: unknown) => Promise<string | null>>()
const diffSince = vi.fn<(request: unknown) => Promise<string | null>>()

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
  readHandoff.mockReset()
  diffSince.mockReset()
  diffSince.mockResolvedValue(null)
  readHandoff.mockResolvedValue('feat: from the agent\n')
  detectAgents.mockReset()
  detectAgents.mockResolvedValue({ claude: true, codex: true })
  setPrNotice.mockReset()
  workspace.sessions = []
  workspace.activeSessionId = null
  submitted.length = 0
  inserted.length = 0
  preflight.mockResolvedValue({ ok: true, merged: false, uncommitted: 1 })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  vi.stubGlobal('window', {
    tr: {
      pr: { write: async () => ({ ok: true, kind: 'commit', agent: 'claude', message: 'feat: new' }), cancelWrite: () => {}, refresh: async () => {}, commit },
      ship: { shipToMain, pushBase, preflight, sync, pull, diffSince, handoff: async (r: { kind: string }) => ({ ok: true, path: `/repo-wt/.git/wavi/${r.kind}.md` }), readHandoff },
      agent: { onEvent: () => () => {} },
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

  // Review findings 15 / 35 / 16: whether the run's commit went in is decided from the commit, not from a file count.
  describe('the run’s own commit', () => {
    const DIFF_A = 'diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+x\n'
    /** A run that was under way when the window went, taken up again in a new one. */
    async function reloaded(kind: 'main' | 'commit', hang: () => void): Promise<void> {
      hang()
      startShip(ctx, kind, kind === 'main' ? 'feat: new' : '提交 1 个文件', { head: 'h0' })
      await settle()
      submitShip(ctx.worktree)
      await settle()
      const [saved] = savedShipRuns()
      expect(saved!.ctx.head).toBe('h0')
      cancelShip(ctx.worktree)
      restoreShipRuns([saved!], ctx.settings)
    }

    it('合并到 main 并推送: a commit of the ticked files on top of where the run started is not made again, although unticked files are left', async () => {
      await reloaded('main', () => shipToMain.mockReturnValueOnce(new Promise(() => {})))
      preflight.mockResolvedValueOnce({ ok: true, merged: false, uncommitted: 2, head: 'h1' })
      diffSince.mockResolvedValueOnce(DIFF_A)
      shipToMain.mockResolvedValueOnce({ ok: true, commit: 'c3', pushed: true })
      retryShip(ctx.worktree)
      await settle()
      expect(diffSince).toHaveBeenCalledWith({ root: '/repo', worktree: '/repo-wt', since: 'h0' })
      expect(shipToMain).toHaveBeenLastCalledWith(expect.objectContaining({ paths: null }))
    })

    it('合并到 main 并推送: a branch still where the run started commits again, although nothing is uncommitted', async () => {
      await reloaded('main', () => shipToMain.mockReturnValueOnce(new Promise(() => {})))
      preflight.mockResolvedValueOnce({ ok: true, merged: false, uncommitted: 0, head: 'h0' })
      shipToMain.mockResolvedValueOnce({ ok: true, commit: 'c3', pushed: true })
      retryShip(ctx.worktree)
      await settle()
      expect(shipToMain).toHaveBeenLastCalledWith(expect.objectContaining({ paths: ['new.txt'] }))
    })

    it('a commit of other files on top is not the run’s', async () => {
      await reloaded('main', () => shipToMain.mockReturnValueOnce(new Promise(() => {})))
      preflight.mockResolvedValueOnce({ ok: true, merged: false, uncommitted: 1, head: 'h1' })
      diffSince.mockResolvedValueOnce('diff --git a/other.txt b/other.txt\n')
      shipToMain.mockResolvedValueOnce({ ok: true, commit: 'c3', pushed: true })
      retryShip(ctx.worktree)
      await settle()
      expect(shipToMain).toHaveBeenLastCalledWith(expect.objectContaining({ paths: ['new.txt'] }))
    })

    it('提交…: the commit that went in while no window watched finishes the run instead of committing again', async () => {
      await reloaded('commit', () => commit.mockReturnValueOnce(new Promise(() => {})))
      expect(state().error).toMatchObject({ step: 'commit' })
      preflight.mockResolvedValueOnce({ ok: true, merged: false, uncommitted: 1, head: 'h1abcdef' })
      diffSince.mockResolvedValueOnce(DIFF_A)
      retryShip(ctx.worktree)
      await settle()
      expect(commit).toHaveBeenCalledTimes(1)
      expect(useShips.getState().byWorktree[ctx.worktree]).toBeUndefined()
      expect(setPrNotice).toHaveBeenLastCalledWith('/repo-wt', { tone: 'muted', text: '已提交 · h1abcde' })
    })

    it('remembers the hash it made and saves it', async () => {
      await reloaded('main', () => shipToMain.mockReturnValueOnce(new Promise(() => {})))
      preflight.mockResolvedValueOnce({ ok: true, merged: false, uncommitted: 0, head: 'h1' })
      diffSince.mockResolvedValueOnce(DIFF_A)
      shipToMain.mockResolvedValueOnce({ ok: false, step: 'merge', reason: 'conflicts', message: '1 个文件和 main 冲突', conflicts: ['a.txt'] })
      retryShip(ctx.worktree)
      await settle()
      expect(savedShipRuns()[0]).toMatchObject({ commit: 'h1' })
    })

    it('an older saved run without the start tip keeps the old check', async () => {
      shipToMain.mockReturnValueOnce(new Promise(() => {}))
      startShip(ctx, 'main', 'feat: new')
      await settle()
      submitShip(ctx.worktree)
      await settle()
      const [saved] = savedShipRuns()
      const { head: _head, ...old } = saved!.ctx
      cancelShip(ctx.worktree)
      restoreShipRuns([{ ...saved!, ctx: old }], ctx.settings)
      preflight.mockResolvedValueOnce({ ok: true, merged: false, uncommitted: 0, head: 'h1' })
      shipToMain.mockResolvedValueOnce({ ok: true, commit: 'c3', pushed: true })
      retryShip(ctx.worktree)
      await settle()
      expect(diffSince).not.toHaveBeenCalled()
      expect(shipToMain).toHaveBeenLastCalledWith(expect.objectContaining({ paths: null }))
    })
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

  // Review finding 14: the session's agent is told which files the commit takes.
  it('提交… written by the session’s agent names the ticked files in its hand-off', async () => {
    workspace.sessions = [{ id: 's1', kind: 'claude', status: 'idle', worktreeId: 'w1' }]
    startShip({ ...commitCtx, sessionId: 's1' }, 'commit', '提交 2 个文件')
    await settle()
    expect(state()).toMatchObject({ stage: 'glance', texts: { commit: 'feat: from the agent' } })
    expect(submitted).toHaveLength(1)
    expect(submitted[0]!.text).toContain('只描述下面这 2 个文件的改动')
    expect(submitted[0]!.text).toContain('> a.txt\n> b.txt')
  })

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

  // Review finding 40: a failed commit keeps its message editable, and 重试 / ⌘↵ commits the edited text without a new write.
  it('提交… whose commit-msg hook refused: the edited message is committed on 重试, nothing is written again', async () => {
    const write = vi.fn(async () => ({ ok: true, kind: 'commit', agent: 'claude', message: 'feat: new' }))
    ;(window as unknown as { tr: { pr: { write: typeof write } } }).tr.pr.write = write
    const failure = { kind: 'commit-hook' as const, message: 'commit-msg hook 没通过', next: 'handoff' as const, tail: 'subject may not be empty' }
    commit.mockResolvedValueOnce({ ok: false, reason: 'failed', message: '提交没有成功', failure })
    startShip(commitCtx, 'commit', '提交 2 个文件')
    await settle()
    submitShip(ctx.worktree)
    await settle()
    expect(state().error).toMatchObject({ step: 'commit', failure })
    expect(shipCanRetry(state())).toBe(true)
    editShip(ctx.worktree, { commit: 'fix(x): a subject commitlint takes' })
    commit.mockResolvedValueOnce({ ok: true, commit: 'abc1234def', subject: 'fix(x): a subject commitlint takes' })
    retryShip(ctx.worktree)
    await settle()
    expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'fix(x): a subject commitlint takes' }))
    expect(write).toHaveBeenCalledTimes(1)
    expect(setPrNotice).toHaveBeenLastCalledWith('/repo-wt', { tone: 'muted', text: '已提交 · abc1234' })
  })

  it('a failure past the commit, or before Wavi’s steps ran, offers no commit retry of its own', async () => {
    const failure = { kind: 'auth' as const, message: '推送需要登录', next: null, tail: '' }
    pull.mockResolvedValueOnce({ ok: false, reason: 'failed', failure })
    startShip({ ...ctx, paths: null }, 'pull', '拉取')
    await settle()
    expect(shipCanRetry(state())).toBe(false)
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

  it('同步 main: both steps done, the block goes with 已同步 main', async () => {
    sync.mockResolvedValueOnce({ ok: true })
    startShip({ ...ctx, paths: null }, 'sync', '同步 main', { syncMode: 'rebase' })
    await settle()
    expect(useShips.getState().byWorktree[ctx.worktree]).toBeUndefined()
    expect(setPrNotice).toHaveBeenLastCalledWith('/repo-wt', { tone: 'muted', text: '已同步 main' })
  })

  // Review finding 34: a base that could not catch up is said on the step, and the block stays until it is closed.
  it('同步 main whose base could not catch up keeps the block with that sentence as the step’s note', async () => {
    sync.mockResolvedValueOnce({ ok: true, baseNotCaughtUp: 'main 有未提交的改动，没有快进' })
    startShip({ ...ctx, paths: null }, 'sync', '同步 main', { syncMode: 'rebase' })
    await settle()
    expect(state().error).toBeNull()
    expect(state().steps.map((s) => [s.id, s.state, s.note])).toEqual([
      ['sync', 'done', 'main 有未提交的改动，没有快进'],
      ['merge', 'done', undefined]
    ])
    expect(shipFinished(state())).toBe(true)
    cancelShip(ctx.worktree)
    expect(useShips.getState().byWorktree[ctx.worktree]).toBeUndefined()
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

  // Review findings 20 / 41: 交给 <agent> names, enables and types into the same session: the one the run started with.
  it('the hand-off goes to the run’s session, whichever session is active now', async () => {
    workspace.sessions = [
      { id: 's1', kind: 'claude', status: 'idle', worktreeId: 'w1' },
      { id: 's2', kind: 'codex', status: 'idle', worktreeId: 'w1' }
    ]
    workspace.activeSessionId = 's2'
    sync.mockResolvedValueOnce({ ok: false, reason: 'conflicts', files: ['src/store.ts'], mode: 'rebase', conflicts: [] })
    startShip({ ...ctx, sessionId: 's1', paths: null }, 'sync', '同步 main', { syncMode: 'rebase' })
    await settle()
    expect(shipHandoffSession(ctx.worktree)?.id).toBe('s1')
    await handConflictsToAgent(ctx.worktree)
    expect(inserted.map((i) => i.id)).toEqual(['s1'])
  })

  it('a run started without an agent session offers no hand-off, even once one is opened', async () => {
    sync.mockResolvedValueOnce({ ok: false, reason: 'conflicts', files: ['src/store.ts'], mode: 'rebase', conflicts: [] })
    startShip({ ...ctx, paths: null }, 'sync', '同步 main', { syncMode: 'rebase' })
    await settle()
    workspace.sessions = [{ id: 's1', kind: 'claude', status: 'idle', worktreeId: 'w1' }]
    expect(shipHandoffSession(ctx.worktree)).toBeNull()
    // A session that closed meanwhile is no hand-off either.
    cancelShip(ctx.worktree)
    sync.mockResolvedValueOnce({ ok: false, reason: 'conflicts', files: ['src/store.ts'], mode: 'rebase', conflicts: [] })
    startShip({ ...ctx, sessionId: 's9', paths: null }, 'sync', '同步 main', { syncMode: 'rebase' })
    await settle()
    expect(shipHandoffSession(ctx.worktree)).toBeNull()
  })

  it('拉取 of a diverged branch fails with the merge hand-off', async () => {
    pull.mockResolvedValueOnce({ ok: false, reason: 'failed', failure: { kind: 'diverged', message: '远程分支和本地分叉', next: 'handoff', tail: 'fatal: Not possible to fast-forward' } })
    startShip({ ...ctx, paths: null }, 'pull', '拉取')
    await settle()
    expect(state().error).toMatchObject({ step: 'sync', message: '远程分支和本地分叉' })
    expect(state().error!.prompt).toContain('git pull --no-rebase origin feat')
  })
})
