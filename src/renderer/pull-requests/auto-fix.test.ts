// 自动修复 across a reload, driven against a fake window.tr: the order things arrive in when main is still running.
import { describe, expect, it, vi } from 'vitest'
import type { SavedFixRun } from '@shared/saved-runs'

const saved: SavedFixRun = {
  scope: 'pr',
  worktree: '/repo-wt',
  number: 7,
  run: { kind: 'fixing', sessionId: 's1', key: 'k', checks: ['test'], baseFailing: null, since: 'abc1234', sentAt: 1 }
}
const sessions = [{ id: 's1', worktreeId: 'w1', kind: 'claude', title: 'fix', status: 'idle', phase: 'ready', startedAt: 1, lastActivityAt: 1 }]

vi.mock('../state/persistence', () => ({ initialWorkspaceFile: () => ({ fixRuns: [saved] }), addSnapshotPart: () => () => {}, requestSave: () => {} }))
vi.mock('../state/workspace', () => ({
  useWorkspace: {
    getState: () => ({ sessions, worktrees: [{ id: 'w1', projectId: 'p1', path: '/repo-wt' }], projects: [{ id: 'p1', rootPath: '/repo' }], activeSessionId: 's1' }),
    subscribe: () => () => {}
  }
}))
vi.mock('../session-io', () => ({ interruptAgent: () => {}, submitPrompt: async () => {} }))
vi.mock('../review/background', () => ({ useBackgroundReview: { getState: () => ({ byRoot: {} }) } }))

describe('自动修复 after a reload (architecture review, batch 6)', () => {
  it('keeps the fix that was under way although the PR status arrives before the settings', async () => {
    let settingsArrive: (value: unknown) => void = () => {}
    vi.stubGlobal('window', {
      tr: {
        settings: { get: () => new Promise((resolve) => (settingsArrive = resolve)), onChange: () => () => {} },
        agent: { onEvent: () => () => {} },
        ship: { onBaseCi: () => () => {}, baseCi: async () => null },
        pr: { setMergeWhenGreen: async () => null },
        ui: { notify: () => {} }
      }
    })
    const { DEFAULT_SETTINGS } = await import('@shared/settings')
    const { startPrAutomation } = await import('./auto-fix')
    const { acceptPrStatus, usePullRequests } = await import('./store')
    const stop = startPrAutomation()
    // main is still up after a reload: the PR's cached status comes back before the settings do.
    acceptPrStatus({
      worktree: '/repo-wt',
      branch: 'feat',
      checkedAt: 1,
      pr: { number: 7, state: 'open', url: 'u', title: 't', checks: { state: 'failing', total: 1, passed: 0, pending: 0, failing: [{ name: 'test', runId: 1, jobId: 1 }] } }
    } as never)
    expect(usePullRequests.getState().automation['/repo-wt']?.run).toMatchObject({ kind: 'stopped', since: 'abc1234', decision: { reason: 'interrupted' } })
    settingsArrive({ ...DEFAULT_SETTINGS, pr: { ...DEFAULT_SETTINGS.pr, autoFix: true } })
    await new Promise((r) => setTimeout(r, 0))
    // The switch follows the default; the run still waits for the user.
    expect(usePullRequests.getState().automation['/repo-wt']).toMatchObject({ autoFix: true, run: { kind: 'stopped' } })
    stop()
    vi.unstubAllGlobals()
  })
})
