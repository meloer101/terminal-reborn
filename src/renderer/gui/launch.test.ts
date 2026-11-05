import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GuiEvent, GuiLaunch, GuiOpenResult } from '@shared/gui-chat'
import { emptyGuiState } from '@shared/gui-chat'

// The workspace and the dispatch queue, as far as opening a GUI session reads and writes them.
const ws = vi.hoisted(() => ({
  sessions: [{ id: 's-1', kind: 'claude', ui: 'gui', dispatchedBy: 's-0' }] as Array<Record<string, unknown>>,
  patches: [] as unknown[][]
}))
vi.mock('../state/workspace', () => ({
  useWorkspace: { getState: () => ({ sessions: ws.sessions, patchSession: (...args: unknown[]) => ws.patches.push(args) }), subscribe: () => () => {} }
}))
const dispatch = vi.hoisted(() => ({ launch: undefined as { initialPrompt: string; model?: string } | undefined }))
vi.mock('../dispatch/store', () => ({ takeDispatchLaunch: () => dispatch.launch }))

// Main's side of `window.tr.gui`, faked.
const main = vi.hoisted(() => ({
  opened: [] as GuiLaunch[],
  result: null as GuiOpenResult | null,
  emit: null as ((sessionId: string, events: GuiEvent[]) => void) | null
}))
vi.stubGlobal('window', {
  tr: {
    gui: {
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

const { guiLaunch, openGuiSession } = await import('./launch')
const { guiStateOf, useGuiSessions } = await import('./store')
const { useLaunchIssues } = await import('../lifecycle/launch-issues')

beforeEach(() => {
  main.opened = []
  main.result = null
  ws.patches = []
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

  it('reports an agent that dies later the same way', async () => {
    main.result = { ok: true, state: emptyGuiState() }
    await openGuiSession('s-1', '/w', 'claude', undefined)
    main.emit?.('s-1', [{ type: 'failure', failure: '进程退出，退出码 1' }])
    expect(useLaunchIssues.getState().issues['s-1']).toEqual({ kind: 'spawn-failed', message: '进程退出，退出码 1' })
  })
})
