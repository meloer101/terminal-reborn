import { beforeEach, describe, expect, it } from 'vitest'
import type { Session, SessionStatus } from '@shared/types'
import { OVERVIEW_TAG, StatusController, type StatusDeps } from './controller'

const session = (id: string, status: SessionStatus = 'idle', kind: Session['kind'] = 'claude'): Session => ({
  id,
  worktreeId: 'w',
  kind,
  title: `任务 ${id}`,
  status,
  startedAt: 0,
  lastActivityAt: 0
})

interface Harness {
  controller: StatusController
  sessions: Session[]
  notifications: { title: string; body: string; tag: string }[]
  badges: number[]
  active: { id: string | null }
  focus: { value: boolean }
  clock: { now: number }
  /** Callbacks scheduled with `later`; `flush()` runs them. */
  timers: (() => void)[]
  flush(): void
  overviewOpened: number
}

function harness(initial: Session[], activeId: string | null = null): Harness {
  const h: Harness = {
    sessions: initial,
    notifications: [],
    badges: [],
    active: { id: activeId },
    focus: { value: true },
    clock: { now: 1_000_000 },
    timers: [],
    flush: () => {
      const due = h.timers
      h.timers = []
      due.forEach((fn) => fn())
    },
    overviewOpened: 0,
    controller: undefined as unknown as StatusController
  }
  const deps: StatusDeps = {
    now: () => h.clock.now,
    sessions: () => h.sessions,
    activeSessionId: () => h.active.id,
    windowFocused: () => h.focus.value,
    patch: (id, patch) => {
      h.sessions = h.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s))
    },
    setActive: (id) => {
      h.active.id = id
    },
    setBadge: (n) => h.badges.push(n),
    notify: (n) => h.notifications.push(n),
    projectName: (id) => (id === 'b' ? 'acme' : undefined),
    openOverview: () => {
      h.overviewOpened += 1
    },
    later: (fn) => {
      h.timers.push(fn)
    }
  }
  h.controller = new StatusController(deps)
  h.controller.sync()
  return h
}

const status = (h: Harness, id: string) => h.sessions.find((s) => s.id === id)?.status

describe('StatusController', () => {
  let h: Harness
  beforeEach(() => {
    h = harness([session('a'), session('b')], 'a')
  })

  it('patches the store from events', () => {
    h.controller.handleEvent('b', { type: 'tool-start', tool: 'Read', input: { file_path: '/x/a.ts' } })
    const b = h.sessions.find((s) => s.id === 'b')
    expect(b?.status).toBe('running')
    expect(b?.currentAction).toBe('读取 a.ts')
  })

  it('revives a session whose process was started again in place', () => {
    h.controller.handleEvent('b', { type: 'tool-start', tool: 'Read', input: { file_path: '/x/a.ts' } })
    h.controller.handlePtyExit('b', -1)
    expect(status(h, 'b')).toBe('error')
    h.controller.handleRestart('b')
    expect(status(h, 'b')).toBe('idle')
    h.controller.handleEvent('b', { type: 'tool-start', tool: 'Read', input: { file_path: '/x/a.ts' } })
    expect(status(h, 'b')).toBe('running')
  })

  it('ignores events for unknown sessions', () => {
    h.controller.handleEvent('nope', { type: 'stop' })
    expect(h.notifications).toEqual([])
  })

  it('does not patch when nothing changed', () => {
    const before = h.sessions
    h.controller.tick()
    h.controller.refreshViewing()
    expect(h.sessions).toBe(before)
  })

  describe('notifications', () => {
    it('notifies for a background session that needs you, with the action in the body', () => {
      h.controller.handleEvent('b', { type: 'tool-start', tool: 'Bash', input: { command: 'pnpm test' } })
      h.controller.handleEvent('b', { type: 'notification', kind: 'permission', message: 'm' })
      expect(h.notifications).toEqual([{ title: 'acme · 任务 b', body: '等你处理 · 等你确认：运行 pnpm test', tag: 'b' }])
    })

    it('notifies on done_unread (with the last reply, a moment later) and error', () => {
      h.controller.handleEvent('b', { type: 'prompt-submit', prompt: 'x' })
      h.controller.handleEvent('b', { type: 'stop', message: '全部测试通过' })
      expect(status(h, 'b')).toBe('done_unread')
      expect(h.notifications).toEqual([])
      h.flush()
      h.controller.handleEvent('b', { type: 'prompt-submit', prompt: 'y' })
      h.controller.handleEvent('b', { type: 'stop-failure', message: 'rate limited' })
      expect(h.notifications.map((n) => n.body)).toEqual(['已完成 · 全部测试通过', '出错 · rate limited'])
    })

    it('turns that finish together share one notification that opens the overview', () => {
      h = harness([session('a'), session('b'), session('c')], 'a')
      for (const id of ['b', 'c']) {
        h.controller.handleEvent(id, { type: 'prompt-submit', prompt: 'x' })
        h.controller.handleEvent(id, { type: 'stop' })
      }
      h.flush()
      expect(h.notifications).toEqual([{ title: '2 个会话已完成', body: 'acme · 任务 b、任务 c', tag: OVERVIEW_TAG }])
      h.controller.handleNotificationClick(OVERVIEW_TAG)
      expect(h.overviewOpened).toBe(1)
    })

    it('drops a finished turn the user looked at before it was announced', () => {
      h.controller.handleEvent('b', { type: 'prompt-submit', prompt: 'x' })
      h.controller.handleEvent('b', { type: 'stop' })
      h.active.id = 'b'
      h.controller.refreshViewing()
      h.flush()
      expect(h.notifications).toEqual([])
    })

    it('never notifies for the active session while the window is focused', () => {
      h.controller.handleEvent('a', { type: 'notification', kind: 'permission', message: 'm' })
      h.controller.handleEvent('a', { type: 'stop' })
      expect(h.notifications).toEqual([])
      expect(status(h, 'a')).toBe('idle')
    })

    it('notifies for the active session when the window is not focused', () => {
      h.focus.value = false
      h.controller.refreshViewing()
      h.controller.handleEvent('a', { type: 'stop' })
      expect(status(h, 'a')).toBe('done_unread')
      h.flush()
      expect(h.notifications).toHaveLength(1)
      expect(h.notifications[0]?.tag).toBe('a')
    })

    it('does not notify for statuses that do not need the user', () => {
      h.controller.handleEvent('b', { type: 'prompt-submit', prompt: 'x' })
      h.controller.handleEvent('b', { type: 'session-end' })
      expect(h.notifications).toEqual([])
    })

    it('does not repeat a notification when the status is unchanged', () => {
      h.controller.handleEvent('b', { type: 'notification', kind: 'permission', message: 'm' })
      h.controller.handleEvent('b', { type: 'notification', kind: 'permission', message: 'm' })
      expect(h.notifications).toHaveLength(1)
    })

    it('clicking a notification activates its session', () => {
      h.controller.handleNotificationClick('b')
      expect(h.active.id).toBe('b')
      h.controller.handleNotificationClick('gone')
      expect(h.active.id).toBe('b')
    })
  })

  describe('viewing', () => {
    it('selecting a done_unread session while focused marks it seen', () => {
      h.controller.handleEvent('b', { type: 'stop' })
      expect(status(h, 'b')).toBe('done_unread')
      h.active.id = 'b'
      h.controller.refreshViewing()
      expect(status(h, 'b')).toBe('idle')
    })

    it('a done_unread session stays unread while the window is blurred', () => {
      h.controller.handleEvent('b', { type: 'stop' })
      h.focus.value = false
      h.active.id = 'b'
      h.controller.refreshViewing()
      expect(status(h, 'b')).toBe('done_unread')
      h.focus.value = true
      h.controller.refreshViewing()
      expect(status(h, 'b')).toBe('idle')
    })

    it('stop on the session being looked at goes straight to idle', () => {
      h.controller.handleEvent('a', { type: 'prompt-submit', prompt: 'x' })
      h.controller.handleEvent('a', { type: 'stop' })
      expect(status(h, 'a')).toBe('idle')
    })

    it('every pane of a split counts as looked at (PRD F20): no unread, no notification', () => {
      const shown = { ids: ['a', 'b'] }
      const split = harness([session('a'), session('b'), session('c')], 'a')
      const deps = (split.controller as unknown as { deps: StatusDeps }).deps
      deps.shownSessionIds = () => shown.ids
      split.controller.refreshViewing()
      split.controller.handleEvent('b', { type: 'prompt-submit', prompt: 'x' })
      split.controller.handleEvent('b', { type: 'stop' })
      expect(status(split, 'b')).toBe('idle')
      split.controller.handleEvent('c', { type: 'stop' })
      expect(status(split, 'c')).toBe('done_unread')
      // Showing c in a pane marks it seen.
      shown.ids = ['a', 'c']
      split.controller.refreshViewing()
      expect(status(split, 'c')).toBe('idle')
    })

    it('leaving a session makes its next stop unread', () => {
      h.active.id = 'b'
      h.controller.refreshViewing()
      h.controller.handleEvent('a', { type: 'stop' })
      expect(status(h, 'a')).toBe('done_unread')
    })
  })

  describe('badge', () => {
    it('reports the initial count once, then only on change', () => {
      expect(h.badges).toEqual([0])
      h.controller.handleEvent('b', { type: 'notification', kind: 'question', message: 'm' })
      h.controller.handleEvent('b', { type: 'tool-end', tool: 'AskUserQuestion', input: {}, ok: true })
      h.controller.handleEvent('b', { type: 'tool-start', tool: 'Read', input: {} })
      expect(h.badges).toEqual([0, 1, 0])
    })

    it('counts needs_you, error and done_unread together', () => {
      h.controller.handleEvent('a', { type: 'prompt-submit', prompt: 'x' })
      h.controller.handleEvent('a', { type: 'notification', kind: 'permission', message: 'm' })
      h.controller.handleEvent('b', { type: 'stop-failure' })
      expect(h.badges.at(-1)).toBe(2)
    })

    it('starts from the persisted count and follows removed sessions', () => {
      const g = harness([session('a', 'done_unread'), session('b', 'error'), session('c', 'running')])
      expect(g.badges).toEqual([2])
      g.sessions = g.sessions.filter((s) => s.id !== 'a')
      g.controller.sync()
      expect(g.badges).toEqual([2, 1])
      expect(g.controller.stateOf('a')).toBeUndefined()
    })
  })

  describe('pty and shell sessions', () => {
    it('a non-zero exit while running is an error and notifies', () => {
      h.controller.handleEvent('b', { type: 'prompt-submit', prompt: 'x' })
      h.controller.handlePtyExit('b', 1)
      expect(status(h, 'b')).toBe('error')
      expect(h.notifications.at(-1)?.body).toContain('出错')
    })

    it('shell sessions only go idle → exited', () => {
      const g = harness([session('sh', 'idle', 'shell')])
      g.controller.handleEvent('sh', { type: 'stop' })
      g.controller.handleTitle('sh', '⠐ zsh')
      expect(status(g, 'sh')).toBe('idle')
      g.controller.handlePtyExit('sh', 0)
      expect(status(g, 'sh')).toBe('exited')
      expect(g.notifications).toEqual([])
    })
  })

  describe('self-heal', () => {
    it('heals a turn that ended without a Stop (interrupt) once the title is idle and hooks are quiet', () => {
      h.controller.handleEvent('b', { type: 'prompt-submit', prompt: 'x' })
      h.controller.handleTitle('b', '✳ Claude Code')
      h.clock.now += 5_000
      h.controller.tick()
      expect(status(h, 'b')).toBe('running')
      h.clock.now += 1_000
      h.controller.tick()
      expect(status(h, 'b')).toBe('idle')
      expect(h.controller.hasRunning()).toBe(false)
    })
  })
})
