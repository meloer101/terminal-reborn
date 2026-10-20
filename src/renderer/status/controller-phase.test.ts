// Agent phase through the StatusController: what it patches into the store, and which signals it feeds the machine.
import { beforeEach, describe, expect, it } from 'vitest'
import type { Session, SessionStatus } from '@shared/types'
import { StatusController, type StatusDeps } from './controller'

const session = (id: string, patch: Partial<Session> = {}): Session => ({
  id,
  worktreeId: 'w',
  kind: 'claude',
  title: `任务 ${id}`,
  status: 'idle' as SessionStatus,
  startedAt: 0,
  lastActivityAt: 0,
  ...patch
})

const CLAUDE_UI = 'Claude Code v2.1.299\n❯ Try "x"\n  ⏸ manual mode on'
const TRUST = 'Do you trust the files in this folder?\n❯ 1. Yes, I trust this folder'

interface Harness {
  controller: StatusController
  sessions: Session[]
  screens: Record<string, string>
  silent: Record<string, boolean>
  launched: string[]
  notifications: { title: string; body: string; tag: string }[]
  clock: { now: number }
}

function harness(initial: Session[], activeId: string | null = null): Harness {
  const h: Harness = {
    sessions: initial,
    screens: {},
    silent: {},
    launched: [],
    notifications: [],
    clock: { now: 1_000_000 },
    controller: undefined as unknown as StatusController
  }
  const deps: StatusDeps = {
    now: () => h.clock.now,
    sessions: () => h.sessions,
    activeSessionId: () => activeId,
    windowFocused: () => true,
    patch: (id, patch) => {
      h.sessions = h.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s))
    },
    setActive: () => undefined,
    setBadge: () => undefined,
    notify: (n) => h.notifications.push(n),
    readScreen: (id) => h.screens[id] ?? '',
    setHooksSilent: (id, silent) => {
      h.silent[id] = silent
    },
    onLaunched: (id) => h.launched.push(id)
  }
  h.controller = new StatusController(deps)
  h.controller.sync()
  return h
}

const phase = (h: Harness, id: string) => h.sessions.find((s) => s.id === id)?.phase
const status = (h: Harness, id: string) => h.sessions.find((s) => s.id === id)?.status

describe('phase tracking', () => {
  let h: Harness
  beforeEach(() => {
    h = harness([session('a'), session('sh', { kind: 'shell' })], 'a')
  })

  it('a new agent session starts in starting and the store learns it; shells have no phase', () => {
    expect(phase(h, 'a')).toBe('starting')
    expect(phase(h, 'sh')).toBeUndefined()
  })

  it('a restored session keeps not-started until it is launched', () => {
    const r = harness([session('r', { phase: 'not-started' })])
    expect(phase(r, 'r')).toBe('not-started')
    r.sessions = r.sessions.map((s) => ({ ...s, phase: 'starting' as const })) // startSession() patch
    r.controller.sync()
    expect(r.launched).toEqual(['r'])
    expect(r.controller.stateOf('r')?.phase).toBe('starting')
  })

  it('a restored session the pty daemon kept running follows its hooks again once adopted', () => {
    const r = harness([session('r', { phase: 'not-started' })])
    r.controller.handleEvent('r', { type: 'prompt-submit', prompt: 'x' })
    expect(status(r, 'r')).toBe('idle')
    r.sessions = r.sessions.map((s) => ({ ...s, phase: 'ready' as const })) // adoptLiveSessions() patch
    r.controller.sync()
    expect(r.controller.stateOf('r')?.phase).toBe('ready')
    expect(r.launched).toEqual([])
    r.controller.handleEvent('r', { type: 'notification', kind: 'permission', message: 'm' })
    expect(status(r, 'r')).toBe('needs_you')
    // Quiet at its prompt is not silent hooks: they reported in the run that launched it.
    r.screens.r = CLAUDE_UI
    r.clock.now += 7_000
    r.controller.tick()
    expect(r.silent.r).toBeUndefined()
  })

  it('a restored session whose terminal ended while the app was closed is exited once adopted', () => {
    const r = harness([session('r', { phase: 'not-started' })])
    r.sessions = r.sessions.map((s) => ({ ...s, phase: 'exited' as const, status: 'exited' as const }))
    r.controller.sync()
    expect(r.controller.stateOf('r')).toMatchObject({ phase: 'exited', status: 'exited', ended: true })
  })

  it('the trust dialog on screen moves the session to blocked / needs_you and notifies', () => {
    h.screens.a = TRUST
    h.controller.handleOutput('a')
    expect(phase(h, 'a')).toBe('blocked')
    expect(status(h, 'a')).toBe('needs_you')
    expect(h.sessions[0]?.currentAction).toBe('等你确认：信任此文件夹')
  })

  it('answering it and the UI appearing makes the session ready', () => {
    h.screens.a = TRUST
    h.controller.tick()
    h.screens.a = CLAUDE_UI
    h.controller.tick()
    expect(phase(h, 'a')).toBe('ready')
    expect(status(h, 'a')).toBe('idle')
  })

  it('a hook event makes it ready without looking at the screen', () => {
    h.controller.handleEvent('a', { type: 'session-start', agentSessionId: 'x' })
    expect(phase(h, 'a')).toBe('ready')
  })

  it('a ready claude whose hooks stay quiet is reported hooks-silent', () => {
    h.screens.a = CLAUDE_UI
    h.controller.tick()
    expect(h.silent.a).toBeUndefined()
    h.clock.now += 7_000
    h.controller.tick()
    expect(h.silent.a).toBe(true)
    h.controller.handleEvent('a', { type: 'prompt-submit', prompt: 'x' })
    expect(h.silent.a).toBe(false)
  })

  it('the watchdog signal marks an up-but-silent claude', () => {
    h.screens.a = CLAUDE_UI
    h.controller.tick()
    h.controller.handleHooksSilent('a')
    expect(h.silent.a).toBe(true)
  })

  it('does not read screens it cannot learn from', () => {
    h.controller.handleEvent('a', { type: 'session-start' })
    h.controller.handleEvent('a', { type: 'prompt-submit', prompt: 'x' })
    expect(h.controller.watchesScreens()).toBe(false)
  })

  it('the agent exiting (marker) is an exited phase; relaunching through the store revives it', () => {
    h.controller.handleEvent('a', { type: 'session-start' })
    h.controller.handleMarker('a', { type: 'exit', code: 0 })
    expect(phase(h, 'a')).toBe('exited')
    expect(status(h, 'a')).toBe('exited')
    h.sessions = h.sessions.map((s) => (s.id === 'a' ? { ...s, phase: 'starting' as const, status: 'idle' as const } : s))
    h.controller.sync()
    expect(phase(h, 'a')).toBe('starting')
    expect(h.controller.stateOf('a')?.ended).toBe(false)
  })

  it('after the PTY itself exited, a start still revives the session', () => {
    h.controller.handlePtyExit('a', 0)
    expect(phase(h, 'a')).toBe('exited')
    h.sessions = h.sessions.map((s) => (s.id === 'a' ? { ...s, phase: 'starting' as const, status: 'idle' as const } : s))
    h.controller.sync()
    h.controller.handleEvent('a', { type: 'session-start' })
    expect(phase(h, 'a')).toBe('ready')
  })

  it('a failed launch leaves the session exited', () => {
    h.controller.handleLaunchFailed('a')
    expect(phase(h, 'a')).toBe('exited')
  })

  it('terminal recovery (handleRestart) starts the phase over', () => {
    h.controller.handleEvent('a', { type: 'session-start' })
    h.controller.handlePtyExit('a', -1)
    h.controller.handleRestart('a')
    expect(phase(h, 'a')).toBe('starting')
    expect(h.launched).toContain('a')
  })

  it('/clear keeps the session alive: SessionEnd(clear) then SessionStart', () => {
    h.controller.handleEvent('a', { type: 'session-start' })
    h.controller.handleEvent('a', { type: 'prompt-submit', prompt: 'x' })
    h.controller.handleEvent('a', { type: 'session-end', reason: 'clear' })
    expect(status(h, 'a')).toBe('idle')
    h.controller.handleEvent('a', { type: 'session-start' })
    h.controller.handleEvent('a', { type: 'prompt-submit', prompt: 'y' })
    expect(status(h, 'a')).toBe('running')
    expect(phase(h, 'a')).toBe('ready')
  })
})
