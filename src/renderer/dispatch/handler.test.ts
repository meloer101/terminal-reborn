import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { DispatchToolResult } from '@shared/dispatch'
import { cancelDispatchCall, handleDispatchRequest, setDispatchSettings } from './handler'
import { settleConfirm, useDispatch } from './store'

const addBackgroundSession = vi.fn((): string | null => 'child')

vi.mock('../state/workspace', () => ({
  useWorkspace: {
    getState: () => ({
      sessions: [{ id: 's1', kind: 'claude', title: 'Plan', worktreeId: 'w1', status: 'running' }],
      worktrees: [{ id: 'w1', projectId: 'p1', path: '/repo', isMain: false, branch: 'main', archived: false }],
      projects: [{ id: 'p1', rootPath: '/repo', name: 'repo' }],
      addBackgroundSession,
      patchSession: () => {}
    })
  }
}))
vi.mock('../new-session/creation', () => ({ createWorktreeFor: async () => {}, holdForWorktree: () => {}, startEagerly: () => {} }))
vi.mock('../session-io', () => ({ interruptAgent: () => {} }))
vi.mock('../session-meta/store', () => ({ useSessionMeta: { getState: () => ({}) } }))
vi.mock('../conflict-radar/store', () => ({ markFor: () => null, useRadar: { getState: () => ({}) } }))
vi.mock('./reports', () => ({ deliverTo: () => {} }))

/** Resolves newSessionInfo when the test says so: the call is still being planned until then. */
let releasePlanning: () => void = () => {}

const request = (callId: string) => ({
  callId,
  sessionId: 's1',
  agent: 'claude' as const,
  tool: 'start_sessions' as const,
  args: { sessions: [{ agent: 'claude', task: 'Rename the login route', title: 'Rename' }] }
})

const failure = (result: unknown): string | undefined => {
  const r = result as DispatchToolResult
  return r.ok ? undefined : r.failure
}

describe('start_sessions cancelled by its agent (PRD F21 · §6.14)', () => {
  beforeEach(() => {
    addBackgroundSession.mockClear()
    useDispatch.setState({ confirms: [] })
    const planned = new Promise<void>((resolve) => (releasePlanning = resolve))
    vi.stubGlobal('document', { hasFocus: () => true })
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      tr: {
        app: { detectAgents: async () => ({ claude: true }) },
        gitWorktrees: {
          newSessionInfo: async () => {
            await planned
            return { repo: true, currentBranch: 'main', defaultBranch: 'main', branches: [], prefix: '', worktreesDir: '/wt', takenFolders: [], includeCount: 0, hasSetup: false }
          }
        },
        git: { changes: async () => null },
        ui: { notify: () => {} }
      }
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    setDispatchSettings(DEFAULT_SETTINGS.dispatch)
  })

  it('starts nothing under 自动开始 when cancelled while Wavi plans the batch', async () => {
    setDispatchSettings({ tools: true, autoApprove: true })
    const pending = handleDispatchRequest(request('c1'))
    cancelDispatchCall('c1')
    releasePlanning()
    expect(failure(await pending)).toBe('declined')
    expect(addBackgroundSession).not.toHaveBeenCalled()
  })

  it('never shows the strip when cancelled while Wavi plans the batch', async () => {
    setDispatchSettings({ tools: true, autoApprove: false })
    const pending = handleDispatchRequest(request('c2'))
    cancelDispatchCall('c2')
    releasePlanning()
    expect(failure(await pending)).toBe('declined')
    expect(useDispatch.getState().confirms).toHaveLength(0)
    expect(addBackgroundSession).not.toHaveBeenCalled()
  })

  it('takes the strip away when cancelled while it waits for 开始', async () => {
    setDispatchSettings({ tools: true, autoApprove: false })
    releasePlanning()
    const pending = handleDispatchRequest(request('c3'))
    await vi.waitFor(() => expect(useDispatch.getState().confirms).toHaveLength(1))
    cancelDispatchCall('c3')
    expect(failure(await pending)).toBe('declined')
    expect(useDispatch.getState().confirms).toHaveLength(0)
    expect(addBackgroundSession).not.toHaveBeenCalled()
  })

  it('forgets a cancel once its call is over, so a later call with the same id still starts', async () => {
    setDispatchSettings({ tools: true, autoApprove: false })
    releasePlanning()
    const first = handleDispatchRequest(request('c4'))
    await vi.waitFor(() => expect(useDispatch.getState().confirms).toHaveLength(1))
    cancelDispatchCall('c4')
    await first
    // A cancel for a call that is not running (answered already, or another tool) leaves nothing behind.
    cancelDispatchCall('c4')
    const second = handleDispatchRequest(request('c4'))
    await vi.waitFor(() => expect(useDispatch.getState().confirms).toHaveLength(1))
    settleConfirm('c4', true)
    expect((await second as DispatchToolResult).ok).toBe(true)
    expect(addBackgroundSession).toHaveBeenCalledTimes(1)
  })
})
