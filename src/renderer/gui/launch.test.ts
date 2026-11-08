import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GuiEvent, GuiLaunch, GuiLiveSession, GuiOpenResult } from '@shared/gui-chat'
import { emptyGuiState } from '@shared/gui-chat'

// The workspace and the dispatch queue, as far as opening a GUI session reads and writes them.
const ONE = [{ id: 's-1', kind: 'claude', ui: 'gui', dispatchedBy: 's-0' }]
const ws = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  worktrees: [] as Array<Record<string, unknown>>,
  patches: [] as unknown[][],
  guiPicks: {} as Record<string, Record<string, unknown>>
}))
vi.mock('../state/workspace', () => ({
  useWorkspace: {
    getState: () => ({ sessions: ws.sessions, worktrees: ws.worktrees, guiPicks: ws.guiPicks, retargetSession: (...args: unknown[]) => ws.patches.push(['retarget', ...args]), patchSession: (...args: unknown[]) => ws.patches.push(args) }),
    subscribe: () => () => {}
  }
}))
const dispatch = vi.hoisted(() => ({ launch: undefined as { initialPrompt: string; model?: string } | undefined }))
vi.mock('../dispatch/store', () => ({ takeDispatchLaunch: () => dispatch.launch }))

// Main's side of `window.tr.gui`, faked.
const main = vi.hoisted(() => ({
  opened: [] as GuiLaunch[],
  result: null as GuiOpenResult | null,
  emit: null as ((sessionId: string, events: GuiEvent[]) => void) | null,
  live: [] as GuiLiveSession[],
  stopped: [] as string[]
}))
vi.stubGlobal('window', {
  tr: {
    homeDir: '/home',
    gui: {
      live: () => Promise.resolve(main.live),
      stop: (sessionId: string) => {
        main.stopped.push(sessionId)
        return Promise.resolve()
      },
      open: async (launch: GuiLaunch) => {
        main.opened.push(launch)
        if (!main.result) throw new Error('no daemon')
        return main.result
      },
      onEvents: (listener: (sessionId: string, events: GuiEvent[]) => void) => {
        main.emit = listener
        return () => {}
      }
    }
  }
})

const { adoptGuiSessions, guiLaunch, openGuiSession, retargetGuiSession } = await import('./launch')
const { guiStateOf, setGuiState: setGuiStateForTest, useGuiSessions } = await import('./store')
const { useLaunchIssues } = await import('../lifecycle/launch-issues')

beforeEach(() => {
  main.opened = []
  main.result = null
  main.live = []
  main.stopped = []
  ws.sessions = ONE.map((s) => ({ ...s }))
  ws.worktrees = []
  ws.patches = []
  ws.guiPicks = {}
  dispatch.launch = undefined
  useGuiSessions.setState({ states: {} })
  useLaunchIssues.setState({ issues: {} })
})

describe('guiLaunch', () => {
  it('carries what a terminal spawn would: folder, agent, resume, dispatch', () => {
    expect(guiLaunch({ sessionId: 's', cwd: '/w', agent: 'codex', dispatched: false })).toEqual({ sessionId: 's', cwd: '/w', agent: 'codex' })
    expect(guiLaunch({ sessionId: 's', cwd: '/w', agent: 'claude', dispatched: true, dispatch: { initialPrompt: '写测试', model: 'opus' } })).toEqual({
      sessionId: 's',
      cwd: '/w',
      agent: 'claude',
      dispatched: true,
      initialPrompt: '写测试',
      model: 'opus'
    })
  })

  it('never sends a dispatched task again when resuming', () => {
    expect(guiLaunch({ sessionId: 's', cwd: '/w', agent: 'claude', dispatched: true, resumeAgentSessionId: 'conv', dispatch: { initialPrompt: 'x' } })).toEqual({
      sessionId: 's',
      cwd: '/w',
      agent: 'claude',
      dispatched: true,
      resumeAgentSessionId: 'conv'
    })
  })
})

describe('openGuiSession', () => {
  it('draws what main answers, marks the session up, and folds later events', async () => {
    const state = { ...emptyGuiState(), busy: true }
    main.result = { ok: true, state }
    dispatch.launch = { initialPrompt: '修登录' }
    expect(await openGuiSession('s-1', '/w', 'claude', undefined)).toBe(true)
    expect(main.opened).toEqual([{ sessionId: 's-1', cwd: '/w', agent: 'claude', dispatched: true, initialPrompt: '修登录' }])
    expect(guiStateOf('s-1')).toBe(state)
    expect(ws.patches).toEqual([['s-1', { phase: 'ready' }]])

    main.emit?.('s-1', [
      { type: 'live', live: { kind: 'text', text: '好' } },
      { type: 'items', changes: [{ index: 0, item: { kind: 'text', id: 'a', at: 0, text: '好的' } }] },
      { type: 'busy', busy: false }
    ])
    expect(guiStateOf('s-1')).toMatchObject({ busy: false, live: null, items: [{ id: 'a' }] })
  })

  it('starts a new session with what its agent last ran with; the session’s own 权限 / 计划 win (Figma 65)', async () => {
    main.result = { ok: true, state: emptyGuiState() }
    ws.sessions = [{ id: 's-1', kind: 'claude', ui: 'gui' }]
    ws.guiPicks = { claude: { model: 'opus', effort: 'max', permission: 'auto', plan: true, fast: true } }
    await openGuiSession('s-1', '/w', 'claude', undefined)
    expect(main.opened[0]).toEqual({ sessionId: 's-1', cwd: '/w', agent: 'claude', permission: 'auto', plan: true, model: 'opus', effort: 'max', fast: true })
    ws.sessions = [{ id: 's-1', kind: 'claude', ui: 'gui', guiPermission: 'ask' }]
    await openGuiSession('s-1', '/w', 'claude', undefined)
    expect(main.opened[1]).toMatchObject({ permission: 'ask' })
    expect(main.opened[1]).not.toHaveProperty('plan')
  })

  it('resumes a conversation, or starts a dispatched task, without the agent’s last picks (Figma 65)', async () => {
    main.result = { ok: true, state: emptyGuiState() }
    ws.guiPicks = { claude: { model: 'opus', permission: 'auto', plan: true, fast: true } }
    ws.sessions = [{ id: 's-1', kind: 'claude', ui: 'gui' }]
    await openGuiSession('s-1', '/w', 'claude', 'conv')
    expect(main.opened[0]).toEqual({ sessionId: 's-1', cwd: '/w', agent: 'claude', resumeAgentSessionId: 'conv' })
    dispatch.launch = { initialPrompt: '写测试' }
    await openGuiSession('s-1', '/w', 'claude', undefined)
    expect(main.opened[1]).toEqual({ sessionId: 's-1', cwd: '/w', agent: 'claude', initialPrompt: '写测试' })
  })

  it('drops an answer that comes after the session moved to another agent (Figma 65)', async () => {
    main.result = { ok: false, reason: '会话已关闭' }
    ws.sessions = [{ id: 's-1', kind: 'claude', ui: 'gui' }]
    const opening = openGuiSession('s-1', '/w', 'claude', undefined)
    ws.sessions = [{ id: 's-1', kind: 'codex', ui: 'gui' }]
    expect(await opening).toBe(false)
    expect(guiStateOf('s-1').failure).toBeNull()
    expect(useLaunchIssues.getState().issues['s-1']).toBeUndefined()
  })

  it('shows why it could not start and leaves the session exited (a launch issue)', async () => {
    main.result = { ok: false, reason: '没有找到 grok 命令' }
    expect(await openGuiSession('s-1', '/w', 'grok', 'conv')).toBe(false)
    expect(main.opened[0]).toMatchObject({ resumeAgentSessionId: 'conv' })
    expect(guiStateOf('s-1').failure).toBe('没有找到 grok 命令')
    expect(useLaunchIssues.getState().issues['s-1']).toEqual({ kind: 'spawn-failed', message: '没有找到 grok 命令' })
    expect(ws.patches).toEqual([])
  })

  it('treats a rejected call like a refusal', async () => {
    expect(await openGuiSession('s-1', '/w', 'claude', undefined)).toBe(false)
    expect(guiStateOf('s-1').failure).toBe('no daemon')
  })

  it('a process that ended while the app was away leaves the session exited, its conversation drawn', async () => {
    const state = { ...emptyGuiState(), failure: 'claude 退出了（退出码 1）' }
    main.result = { ok: true, state, exited: true }
    expect(await openGuiSession('s-1', '/w', 'claude', undefined)).toBe(true)
    expect(guiStateOf('s-1')).toBe(state)
    expect(ws.patches).toEqual([['s-1', { phase: 'exited', status: 'exited' }]])
  })

  it('reports an agent that dies later the same way', async () => {
    main.result = { ok: true, state: emptyGuiState() }
    await openGuiSession('s-1', '/w', 'claude', undefined)
    main.emit?.('s-1', [{ type: 'failure', failure: '进程退出，退出码 1' }])
    expect(useLaunchIssues.getState().issues['s-1']).toEqual({ kind: 'spawn-failed', message: '进程退出，退出码 1' })
  })
})

describe('adoptGuiSessions', () => {
  it('opens the GUI sessions whose agent still runs, so status flows before they are viewed, and ends orphans', async () => {
    ws.worktrees = [
      { id: 'w1', path: '/repo' },
      { id: 'w2', path: '/old', archived: { id: 'a' } }
    ]
    ws.sessions = [
      { id: 'g-new', kind: 'codex', ui: 'gui', worktreeId: 'w1', phase: 'not-started', agentSessionId: 'thr-1' },
      { id: 'g-open', kind: 'claude', ui: 'gui', worktreeId: 'w1', phase: 'ready' },
      { id: 'g-archived', kind: 'claude', ui: 'gui', worktreeId: 'w2', phase: 'not-started' },
      { id: 't-1', kind: 'claude', worktreeId: 'w1', phase: 'not-started' }
    ]
    main.live = ['g-new', 'g-open', 'g-archived', 't-1', 'gone'].map((sessionId) => ({ sessionId, exited: false }))
    main.result = { ok: true, state: emptyGuiState() }
    await adoptGuiSessions()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(main.opened).toEqual([{ sessionId: 'g-new', cwd: '/repo', agent: 'codex', resumeAgentSessionId: 'thr-1' }])
    expect(ws.patches).toEqual([['g-new', { phase: 'ready' }]])
    // Closed or archived while the app was away (and an id that is not a GUI session): ended.
    expect(main.stopped).toEqual(['g-archived', 't-1', 'gone'])
  })
})

describe('retargetGuiSession (Figma 65)', () => {
  it('ends the agent, clears its pickers and gives the session the new agent, only while nothing is said', async () => {
    setGuiStateForTest('s-1', { ...emptyGuiState(), config: [{ id: 'model', category: 'model', label: '模型', current: 'opus', values: [] }] })
    await retargetGuiSession('s-1', { kind: 'codex' })
    expect(main.stopped).toEqual(['s-1'])
    expect(guiStateOf('s-1').config).toEqual([])
    expect(ws.patches).toEqual([['retarget', 's-1', { kind: 'codex' }]])

    setGuiStateForTest('s-1', { ...emptyGuiState(), items: [{ kind: 'user', id: 'u', at: 0, text: 'hi', images: 0 }] })
    await retargetGuiSession('s-1', { kind: 'grok' })
    expect(ws.patches).toHaveLength(1)
  })
})
