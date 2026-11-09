import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { DISPATCH_LIMITS, type DispatchRequest, type WaviCommand, type WaviResult } from '@shared/dispatch'
import type { Session } from '@shared/types'
import { decideConfirms, dropConfirmsOf, handleWaviRequest, resumeConfirmTimers, setDispatchSettings } from './handler'
import { restoreDispatch, savedDispatch, useDispatch } from './store'

let sessions: Session[] = []
const addBackgroundSession = vi.fn((_project: string, _target: unknown, _kind: string, id?: string, _ui?: string): string | null => id ?? 'child')
const deliverMessage = vi.fn(async (): Promise<'delivered' | 'held'> => 'delivered')
const queueReport = vi.fn()

vi.mock('../state/workspace', () => ({
  useWorkspace: {
    getState: () => ({
      sessions,
      worktrees: [{ id: 'w1', projectId: 'p1', path: '/repo', isMain: false, branch: 'jacob/plan', archived: false }],
      projects: [{ id: 'p1', rootPath: '/repo', name: 'repo' }],
      addBackgroundSession,
      patchSession: () => {}
    })
  }
}))
let ids = 0
vi.mock('../state/workspace-model', () => ({ randomId: (prefix: string) => `${prefix}-new${++ids}` }))
vi.mock('../new-session/creation', () => ({ createWorktreeFor: async () => true, holdForWorktree: () => {}, startEagerly: () => {} }))
vi.mock('../session-io', () => ({ interruptAgent: () => {} }))
vi.mock('../session-meta/store', () => ({ useSessionMeta: { getState: () => ({ bySession: {} }) } }))
vi.mock('../conflict-radar/store', () => ({ markFor: () => null, useRadar: { getState: () => ({ byRoot: {} }) } }))
vi.mock('./reports', () => ({ deliverMessage: (...args: unknown[]) => deliverMessage(...(args as [])), queueReport: (...args: unknown[]) => queueReport(...args) }))

const session = (id: string, over: Partial<Session> = {}): Session => ({ id, worktreeId: 'w1', kind: 'claude', title: id, status: 'idle', startedAt: 1, lastActivityAt: 1, ...over })

let n = 0
const call = (sessionId: string, command: WaviCommand, deadline = Date.now() + 60_000): Promise<WaviResult> =>
  handleWaviRequest({ callId: `c${++n}`, sessionId, command, deadline } satisfies DispatchRequest)
const runCmd = (task: string, over: Partial<Extract<WaviCommand, { name: 'run' }>> = {}): WaviCommand => ({ name: 'run', agent: 'grok', task, base: 'head', ...over })

describe('wavi in a window (PRD F21)', () => {
  beforeEach(() => {
    sessions = [session('top'), session('child', { dispatchedBy: 'top', kind: 'codex' }), session('grand', { dispatchedBy: 'child', kind: 'gemini' })]
    addBackgroundSession.mockClear()
    deliverMessage.mockClear()
    queueReport.mockClear()
    useDispatch.setState({ confirms: [], held: {}, reported: {} })
    vi.stubGlobal('document', { hasFocus: () => true })
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      tr: {
        app: { detectAgents: async () => ({ claude: true, codex: true, grok: true, gemini: true }) },
        gitWorktrees: {
          newSessionInfo: async () => ({ repo: true, currentBranch: 'jacob/plan', defaultBranch: 'main', branches: [], prefix: 'jacob', worktreesDir: '/wt', takenFolders: [], includeCount: 0, hasSetup: false })
        },
        git: { changes: async () => null },
        ui: { notify: () => {} }
      }
    })
    setDispatchSettings(DEFAULT_SETTINGS.dispatch)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('answers a run from the user’s session at once, naming the session that waits for 开始', async () => {
    const result = await call('top', runCmd('Review the auth code', { base: 'snapshot', title: 'Auth review' }))
    expect(result).toMatchObject({ ok: true, text: expect.stringContaining("waits for the user's 开始") })
    expect(result.text).toContain('end your turn now')
    const [pending] = useDispatch.getState().confirms
    expect(result.text).toContain(`Session ${pending!.childId}`)
    expect(pending!.plan).toMatchObject({ branch: '', request: { snapshotOf: '/repo' } })
    expect(addBackgroundSession).not.toHaveBeenCalled()
  })

  it('starts every waiting request of the dispatcher on 开始 and tells it which ones, in one message', async () => {
    await call('top', runCmd('Fix the login form'))
    await call('top', runCmd('Write login tests', { agent: 'claude' }))
    const [a, b] = useDispatch.getState().confirms
    expect(a!.plan.branch).not.toBe(b!.plan.branch)
    decideConfirms('top', true)
    expect(useDispatch.getState().confirms).toHaveLength(0)
    expect(addBackgroundSession.mock.calls.map((c) => c[3])).toEqual([a!.childId, b!.childId])
    expect(deliverMessage).toHaveBeenCalledTimes(1)
    const text = (deliverMessage.mock.calls[0] as unknown[])[1] as string
    expect(text).toContain('用户同意了')
    expect(text).toContain(`id ${a!.childId} · grok`)
  })

  it('starts nothing on 拒绝 and says so; an agent that went away takes its requests along silently', async () => {
    await call('top', runCmd('Fix the login form'))
    decideConfirms('top', false)
    expect(addBackgroundSession).not.toHaveBeenCalled()
    expect((deliverMessage.mock.calls[0] as unknown[])[1]).toContain('用户拒绝了')
    await call('top', runCmd('Another thing'))
    dropConfirmsOf('top')
    expect(useDispatch.getState().confirms).toHaveLength(0)
    expect(deliverMessage).toHaveBeenCalledTimes(1)
  })

  it('saves what waits for the user, and after a reload still tells the dispatcher when nobody answered', async () => {
    await call('top', runCmd('Fix the login form'))
    const saved = savedDispatch(useDispatch.getState())!
    expect(saved.confirms).toHaveLength(1)
    // The window goes (its request and timer with it); a new one takes the request up and its 10 minutes run again.
    dropConfirmsOf('top')
    restoreDispatch(saved)
    expect(useDispatch.getState().confirms).toEqual(saved.confirms)
    vi.useFakeTimers()
    Object.assign(window, { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })
    try {
      resumeConfirmTimers()
      vi.advanceTimersByTime(DISPATCH_LIMITS.confirmMs)
    } finally {
      vi.useRealTimers()
    }
    expect(useDispatch.getState().confirms).toHaveLength(0)
    expect((deliverMessage.mock.calls.at(-1) as unknown[])[1]).toContain('10 分钟内没有回答')
    expect(savedDispatch(useDispatch.getState())).toBeNull()
  })

  it('lets a child start a grandchild at once, and refuses a grandchild that tries again', async () => {
    const started = await call('child', runCmd('Check the types'))
    expect(started).toMatchObject({ ok: true, text: expect.stringContaining('Started session') })
    expect(addBackgroundSession).toHaveBeenCalledTimes(1)
    expect(await call('grand', runCmd('Go deeper'))).toMatchObject({ ok: false, failure: 'not_allowed' })
  })

  it('refuses an agent that is not installed, a duplicate, and a branch off a detached checkout', async () => {
    expect(await call('top', runCmd('x', { agent: 'cursor' }))).toMatchObject({ ok: false, failure: 'agent_unavailable' })
    await call('top', runCmd('Same task'))
    expect(await call('top', runCmd('Same  task'))).toMatchObject({ ok: false, failure: 'duplicate' })
  })

  it('keeps a tree to 8 sessions, waiting ones included', async () => {
    sessions = [session('top'), ...Array.from({ length: 7 }, (_, i) => session(`k${i}`, { dispatchedBy: i < 3 ? 'top' : 'k0' }))]
    expect(await call('k1', runCmd('one more'))).toMatchObject({ ok: true })
    sessions.push(session('k7', { dispatchedBy: 'k1' }))
    expect(await call('k2', runCmd('and another'))).toMatchObject({ ok: false, failure: 'limit' })
  })

  it('takes a report only from a dispatched session, and hands it to the reports queue', async () => {
    expect(await call('top', { name: 'report', text: 'done' })).toMatchObject({ ok: false, failure: 'not_allowed' })
    expect(await call('child', { name: 'report', text: 'Fixed. Tests pass.' })).toMatchObject({ ok: true, text: expect.stringContaining('Reported to 「top」') })
    expect(queueReport).toHaveBeenCalledWith(expect.objectContaining({ id: 'child' }), 'report', 'Fixed. Tests pass.')
    expect(useDispatch.getState().reported.child).toBe(true)
  })

  it('does nothing once wavi has been told Wavi did not answer', async () => {
    expect(await call('child', runCmd('Too slow'), Date.now() - 1)).toMatchObject({ ok: false, failure: 'wavi_unavailable' })
    expect(addBackgroundSession).not.toHaveBeenCalled()
  })

  it('runs two wavi run at once one after the other, so the limits see both', async () => {
    sessions = [session('top'), ...Array.from({ length: 3 }, (_, i) => session(`k${i}`, { dispatchedBy: 'top' }))]
    const [a, b] = await Promise.all([call('top', runCmd('fourth')), call('top', runCmd('fifth'))])
    expect(a).toMatchObject({ ok: true })
    expect(b).toMatchObject({ ok: false, failure: 'limit' })
  })

  it('never answers a child’s permission prompt with stop, and refuses everything when dispatch is off', async () => {
    sessions[1] = { ...sessions[1]!, status: 'needs_you' }
    expect(await call('top', { name: 'stop', id: 'child' })).toMatchObject({ ok: false, failure: 'not_allowed' })
    setDispatchSettings({ tools: false, autoApprove: false })
    expect(await call('top', { name: 'ls' })).toMatchObject({ ok: false, failure: 'not_allowed' })
    expect(await call('child', { name: 'report', text: 'x' })).toMatchObject({ ok: false, failure: 'not_allowed' })
  })

  it('answers send at once and delivers behind it', async () => {
    expect(await call('top', { name: 'send', id: 'child', text: 'one more thing' })).toMatchObject({ ok: true, text: expect.stringContaining('putting it in') })
    expect((deliverMessage.mock.calls[0] as unknown[])[1]).toContain('one more thing')
  })

  it('opens a GUI dispatcher’s children as GUI when their agent can (PRD F21 v1.161)', async () => {
    sessions[0] = { ...sessions[0]!, ui: 'gui' }
    sessions[1] = { ...sessions[1]!, ui: 'gui' }
    // A dispatched session's child starts at once.
    const started = await call('child', runCmd('Check the types', { agent: 'codex' }))
    expect(started).toMatchObject({ ok: true, text: expect.stringContaining('shown as a chat') })
    expect(addBackgroundSession.mock.calls[0]?.[4]).toBe('gui')
    // The user's own session's child waits for 开始 with its 界面 decided, and keeps it.
    await call('top', runCmd('Fix the login form', { agent: 'claude' }))
    expect(useDispatch.getState().confirms[0]!.plan.item.ui).toBe('gui')
    decideConfirms('top', true)
    expect(addBackgroundSession.mock.calls[1]?.[4]).toBe('gui')
  })

  it('follows --ui, and tells the dispatcher when the GUI it asked for cannot be', async () => {
    const tr = (window as unknown as { tr: { app: { detectAgents: () => Promise<unknown> } } }).tr
    tr.app.detectAgents = async () => ({ claude: true, codex: true, crush: true })
    sessions[1] = { ...sessions[1]!, ui: 'gui' }
    await call('child', runCmd('As a terminal', { agent: 'codex', ui: 'cli' }))
    expect(addBackgroundSession.mock.calls[0]?.[4]).toBe('cli')
    const crush = await call('child', runCmd('Crush in a chat', { agent: 'crush', ui: 'gui' }))
    expect(crush).toMatchObject({ ok: true, text: expect.stringContaining('Crush opens in a terminal: it has no chat mode.') })
    expect(addBackgroundSession.mock.calls[1]?.[4]).toBe('cli')
    // A CLI dispatcher can ask for a chat too; without asking its children stay terminals.
    expect(await call('top', runCmd('Claude in a chat', { agent: 'claude', ui: 'gui' }))).toMatchObject({ ok: true, text: expect.stringContaining('shown as a chat') })
    await call('top', runCmd('Claude in a terminal', { agent: 'claude' }))
    expect(useDispatch.getState().confirms.map((c) => c.plan.item.ui)).toEqual(['gui', undefined])
  })

  it('acts only on the caller’s own sessions', async () => {
    expect(await call('child', { name: 'read', id: 'top', offset: 0 })).toMatchObject({ ok: false, failure: 'not_found' })
    expect(await call('top', { name: 'stop', id: 'grand' })).toMatchObject({ ok: false, failure: 'not_found' })
    expect(await call('top', { name: 'ls' })).toMatchObject({ ok: true, text: expect.stringContaining('id child · codex') })
  })
})
