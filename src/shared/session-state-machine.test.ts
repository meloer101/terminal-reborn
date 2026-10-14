import { describe, expect, it } from 'vitest'
import type { AgentEvent } from './agent-events'
import {
  CODEX_IDLE_HEAL_MS,
  initialState,
  reduce,
  CLAUDE_IDLE_HEAL_MS,
  type SessionState,
  type Signal
} from './session-state-machine'
import type { AgentKind, SessionStatus } from './types'

const T0 = 1_000_000

const ev = (event: AgentEvent): Signal => ({ type: 'event', event })
const toolStart = (tool: string, input: Record<string, unknown> = {}) => ev({ type: 'tool-start', tool, input })
const toolEnd = (tool = 'Bash') => ev({ type: 'tool-end', tool, input: {}, ok: true })
const promptSubmit = ev({ type: 'prompt-submit', prompt: 'hi' })
const stop = ev({ type: 'stop' })
const notification = (kind: 'permission' | 'question' | 'idle' | 'other') =>
  ev({ type: 'notification', kind, message: 'm' })

function make(status: SessionStatus, options: { kind?: AgentKind; viewing?: boolean; action?: string } = {}): SessionState {
  return initialState(options.kind ?? 'claude', T0, { status, viewing: options.viewing, currentAction: options.action })
}

describe('status transitions', () => {
  // [name, from, signal, expected status]
  it.each<[string, SessionStatus, Signal, SessionStatus]>([
    ['prompt-submit from idle', 'idle', promptSubmit, 'running'],
    ['prompt-submit from done_unread', 'done_unread', promptSubmit, 'running'],
    ['prompt-submit from error', 'error', promptSubmit, 'running'],
    ['prompt-submit from needs_you', 'needs_you', promptSubmit, 'running'],
    ['tool-start from idle', 'idle', toolStart('Read', { file_path: '/a.ts' }), 'running'],
    ['tool-start while needs_you (answered in the TUI)', 'needs_you', toolStart('Bash', { command: 'ls' }), 'running'],
    ['tool-end from idle', 'idle', toolEnd(), 'running'],
    ['tool-end after needs_you', 'needs_you', toolEnd(), 'running'],
    ['AskUserQuestion tool-start', 'running', toolStart('AskUserQuestion', { questions: [] }), 'needs_you'],
    ['permission notification', 'running', notification('permission'), 'needs_you'],
    ['question notification', 'running', notification('question'), 'needs_you'],
    ['idle notification does not change status', 'running', notification('idle'), 'running'],
    ['other notification does not change status', 'idle', notification('other'), 'idle'],
    ['stop-failure from running', 'running', ev({ type: 'stop-failure', message: 'rate limited' }), 'error'],
    ['stop-failure from needs_you', 'needs_you', ev({ type: 'stop-failure' }), 'error'],
    ['session-end', 'running', ev({ type: 'session-end', reason: 'exit' }), 'exited'],
    ['session-start keeps idle', 'idle', ev({ type: 'session-start' }), 'idle'],
    ['session-start clears an error', 'error', ev({ type: 'session-start' }), 'idle'],
    ['session-start does not interrupt a running turn (compaction)', 'running', ev({ type: 'session-start' }), 'running'],
    ['pty exit 0', 'idle', { type: 'pty-exit', code: 0 }, 'exited'],
    ['pty exit 0 while running', 'running', { type: 'pty-exit', code: 0 }, 'exited'],
    ['pty exit 1 while running', 'running', { type: 'pty-exit', code: 1 }, 'error'],
    ['pty exit 1 while needs_you', 'needs_you', { type: 'pty-exit', code: 1 }, 'error'],
    ['pty exit 1 while idle is just an exit', 'idle', { type: 'pty-exit', code: 1 }, 'exited'],
    ['pty exit 1 while done_unread is just an exit', 'done_unread', { type: 'pty-exit', code: 137 }, 'exited'],
    ['pty exit 0 after an error', 'error', { type: 'pty-exit', code: 0 }, 'exited'],
    ['viewed clears done_unread', 'done_unread', { type: 'viewed' }, 'idle'],
    ['viewed leaves running alone', 'running', { type: 'viewed' }, 'running'],
    ['viewed leaves needs_you alone', 'needs_you', { type: 'viewed' }, 'needs_you'],
    ['viewed leaves error alone', 'error', { type: 'viewed' }, 'error']
  ])('%s', (_name, from, signal, expected) => {
    expect(reduce(make(from), signal, T0 + 10).status).toBe(expected)
  })

  it('stop → done_unread when the session is not being viewed', () => {
    const next = reduce(make('running', { viewing: false }), stop, T0 + 10)
    expect(next.status).toBe('done_unread')
  })

  it('stop → idle when the session is being viewed', () => {
    const next = reduce(make('running', { viewing: true }), stop, T0 + 10)
    expect(next.status).toBe('idle')
  })

  it('stop while needs_you ends the turn', () => {
    expect(reduce(make('needs_you'), stop, T0 + 10).status).toBe('done_unread')
  })

  it('stop only becomes idle once the user looks away and back', () => {
    let s = make('running', { viewing: true })
    s = reduce(s, { type: 'unviewed' }, T0 + 1)
    s = reduce(s, stop, T0 + 2)
    expect(s.status).toBe('done_unread')
    s = reduce(s, { type: 'viewed' }, T0 + 3)
    expect(s.status).toBe('idle')
    expect(s.viewing).toBe(true)
  })
})

describe('current action', () => {
  it('tool-start sets it from the tool and input', () => {
    const s = reduce(make('idle'), toolStart('Edit', { file_path: '/src/auth/session.ts' }), T0 + 1)
    expect(s.currentAction).toBe('编辑 session.ts')
  })

  it('tool-end keeps the last action', () => {
    let s = reduce(make('idle'), toolStart('Read', { file_path: '/a.ts' }), T0 + 1)
    s = reduce(s, toolEnd('Read'), T0 + 2)
    expect(s.currentAction).toBe('读取 a.ts')
  })

  it('prompt-submit clears the previous action', () => {
    let s = reduce(make('idle'), toolStart('Read', { file_path: '/a.ts' }), T0 + 1)
    s = reduce(s, promptSubmit, T0 + 2)
    expect(s.currentAction).toBeUndefined()
  })

  it.each<[string, SessionStatus, Signal]>([
    ['stop (not viewed)', 'running', stop],
    ['session-end', 'running', ev({ type: 'session-end' })],
    ['pty exit 0', 'running', { type: 'pty-exit', code: 0 }]
  ])('is cleared on %s', (_name, from, signal) => {
    const s = reduce(make(from, { action: '编辑 a.ts' }), signal, T0 + 1)
    expect(s.currentAction).toBeUndefined()
  })

  it('needs_you says what is being asked', () => {
    let s = reduce(make('idle'), toolStart('Bash', { command: 'rm -rf build' }), T0 + 1)
    s = reduce(s, notification('permission'), T0 + 2)
    expect(s.currentAction).toBe('等你确认：运行 rm -rf build')
    s = reduce(s, toolEnd('Bash'), T0 + 3)
    expect(s.status).toBe('running')
    expect(s.currentAction).toBe('运行 rm -rf build')
  })

  it('a permission notification with no known tool still gets a label', () => {
    expect(reduce(make('idle'), notification('permission'), T0 + 1).currentAction).toBe('等你确认')
    expect(reduce(make('idle'), notification('question'), T0 + 1).currentAction).toBe('等你回答')
  })

  it('AskUserQuestion shows the question', () => {
    const s = reduce(make('running'), toolStart('AskUserQuestion', { questions: [{ question: '用哪个库？' }] }), T0 + 1)
    expect(s.currentAction).toBe('提问：用哪个库？')
  })

  it('stop-failure shows the message, clipped', () => {
    const s = reduce(make('running'), ev({ type: 'stop-failure', message: 'x'.repeat(200) }), T0 + 1)
    expect(s.currentAction).toBe(`${'x'.repeat(80)}…`)
    expect(reduce(make('running'), ev({ type: 'stop-failure' }), T0 + 1).currentAction).toBeUndefined()
  })

  it('a crash explains the exit code', () => {
    expect(reduce(make('running'), { type: 'pty-exit', code: 2 }, T0 + 1).currentAction).toBe('进程异常退出，退出码 2')
  })
})

describe('timestamps', () => {
  it('events refresh lastEventAt and lastActivityAt', () => {
    const s = reduce(make('idle'), promptSubmit, T0 + 500)
    expect(s.lastEventAt).toBe(T0 + 500)
    expect(s.lastActivityAt).toBe(T0 + 500)
  })

  it('title, view and tick signals do not count as events', () => {
    let s = make('running')
    s = reduce(s, { type: 'title', title: '✳ Claude Code' }, T0 + 5_000)
    s = reduce(s, { type: 'viewed' }, T0 + 6_000)
    s = reduce(s, { type: 'tick' }, T0 + 7_000)
    expect(s.lastEventAt).toBe(T0)
  })
})

describe('self-heal', () => {
  const idleTitle: Signal = { type: 'title', title: '✳ Claude Code' }
  const tick: Signal = { type: 'tick' }

  it('running + no event for 6 s + idle title → idle', () => {
    let s = reduce(make('running', { action: '读取 a.ts' }), idleTitle, T0 + 1_000)
    s = reduce(s, tick, T0 + CLAUDE_IDLE_HEAL_MS)
    expect(s.status).toBe('idle')
    expect(s.currentAction).toBeUndefined()
  })

  it('does nothing just before the threshold', () => {
    let s = reduce(make('running'), idleTitle, T0 + 1_000)
    s = reduce(s, tick, T0 + CLAUDE_IDLE_HEAL_MS - 1)
    expect(s.status).toBe('running')
  })

  it('does nothing without an idle title', () => {
    const s = reduce(make('running'), tick, T0 + CLAUDE_IDLE_HEAL_MS * 2)
    expect(s.status).toBe('running')
  })

  it('does nothing when the title is busy again', () => {
    let s = reduce(make('running'), idleTitle, T0 + 1_000)
    s = reduce(s, { type: 'title', title: '⠂ Claude Code' }, T0 + 2_000)
    s = reduce(s, tick, T0 + CLAUDE_IDLE_HEAL_MS * 2)
    expect(s.status).toBe('running')
  })

  it('a recent event postpones healing', () => {
    let s = reduce(make('running'), idleTitle, T0 + 1_000)
    s = reduce(s, toolEnd(), T0 + CLAUDE_IDLE_HEAL_MS)
    s = reduce(s, tick, T0 + CLAUDE_IDLE_HEAL_MS + 1_000)
    expect(s.status).toBe('running')
  })

  it('only heals running sessions', () => {
    for (const status of ['needs_you', 'done_unread', 'error'] as const) {
      let s = reduce(make(status), idleTitle, T0 + 1_000)
      s = reduce(s, tick, T0 + CLAUDE_IDLE_HEAL_MS * 2)
      expect(s.status).toBe(status)
    }
  })

  it('a busy title after a quiet period resumes running from idle', () => {
    const s = reduce(make('idle'), { type: 'title', title: '⠐ Claude Code' }, T0 + 10_000)
    expect(s.status).toBe('running')
  })

  it('a busy title right after an event is ignored (tail of the last event)', () => {
    let s = reduce(make('running'), stop, T0 + 10_000)
    s = reduce(s, { type: 'viewed' }, T0 + 10_001)
    expect(s.status).toBe('idle')
    s = reduce(s, { type: 'title', title: '⠐ Claude Code' }, T0 + 10_500)
    expect(s.status).toBe('idle')
  })

  it('a busy title never overrides done_unread, needs_you or error', () => {
    for (const status of ['needs_you', 'done_unread', 'error'] as const) {
      expect(reduce(make(status), { type: 'title', title: '⠐ x' }, T0 + 60_000).status).toBe(status)
    }
  })

  it('needs_you answered in the TUI resolves on the next event', () => {
    let s = reduce(make('running'), notification('permission'), T0 + 1)
    expect(s.status).toBe('needs_you')
    s = reduce(s, toolEnd(), T0 + 60_000)
    expect(s.status).toBe('running')
  })
})

describe('shell sessions', () => {
  const shell = () => make('idle', { kind: 'shell' })

  it.each<[string, Signal]>([
    ['prompt-submit', promptSubmit],
    ['tool-start', toolStart('Bash', { command: 'ls' })],
    ['permission notification', notification('permission')],
    ['stop', stop],
    ['stop-failure', ev({ type: 'stop-failure' })],
    ['busy title', { type: 'title', title: '⠐ zsh' }],
    ['tick', { type: 'tick' }]
  ])('ignore %s', (_name, signal) => {
    expect(reduce(shell(), signal, T0 + CLAUDE_IDLE_HEAL_MS * 2)).toEqual(shell())
  })

  it('exits with any code, never errors', () => {
    expect(reduce(shell(), { type: 'pty-exit', code: 0 }, T0 + 1).status).toBe('exited')
    expect(reduce(shell(), { type: 'pty-exit', code: 130 }, T0 + 1).status).toBe('exited')
  })

  it('a shell whose store status was running starts idle', () => {
    expect(initialState('shell', T0, { status: 'running' }).status).toBe('idle')
  })
})

describe('exited is final', () => {
  it('ignores every later signal', () => {
    const exited = reduce(make('running'), { type: 'pty-exit', code: 0 }, T0 + 1)
    for (const signal of [promptSubmit, toolStart('Bash'), stop, { type: 'viewed' } as Signal, { type: 'tick' } as Signal]) {
      expect(reduce(exited, signal, T0 + 2)).toBe(exited)
    }
  })

  it('an error from a crash is not downgraded by a later session-end', () => {
    const crashed = reduce(make('running'), { type: 'pty-exit', code: 1 }, T0 + 1)
    expect(crashed.status).toBe('error')
    expect(reduce(crashed, ev({ type: 'session-end' }), T0 + 2).status).toBe('error')
  })
})

describe('referential stability', () => {
  it('returns the same state for a no-op signal', () => {
    const s = make('idle', { viewing: true })
    expect(reduce(s, { type: 'viewed' }, T0 + 1)).toBe(s)
    expect(reduce(s, { type: 'tick' }, T0 + 1)).toBe(s)
    expect(reduce(s, { type: 'title', title: 'zsh' }, T0 + 1)).toBe(s)
  })
})

// Codex titles (docs/spikes/codex.md §5): braille spinner = busy, `Action Required` = its own dialog, anything else = idle.
describe('codex titles', () => {
  const codex = (status: SessionStatus, action?: string) => make(status, { kind: 'codex', action })
  const title = (t: string): Signal => ({ type: 'title', title: t })
  const BUSY = '⠼ tr-codex-lab'
  const IDLE = 'tr-codex-lab'
  const ACTION = '[ ! ] Action Required | tr-codex-lab'

  it('a spinner after a quiet period starts running (startup, MCP loading)', () => {
    expect(reduce(codex('idle'), title(BUSY), T0 + 10_000)).toMatchObject({ status: 'running', titleRun: true })
  })

  it('a spinner right after an event is only that event\'s tail', () => {
    expect(reduce(codex('idle'), title(BUSY), T0 + 500).status).toBe('idle')
  })

  it('a run inferred from the spinner alone ends as soon as the title goes idle', () => {
    let s = reduce(codex('idle'), title(BUSY), T0 + 10_000)
    s = reduce(s, title(IDLE), T0 + 12_000)
    expect(s).toMatchObject({ status: 'idle', titleRun: false, titleIdle: true })
  })

  it('a hook event confirms the run; the idle title then waits out the heal window', () => {
    let s = reduce(codex('idle'), title(BUSY), T0 + 10_000)
    s = reduce(s, toolStart('Bash', { command: 'ls' }), T0 + 10_500)
    expect(s.titleRun).toBe(false)
    s = reduce(s, title(IDLE), T0 + 11_000)
    expect(s.status).toBe('running')
  })

  it('a turn Codex never closed (Esc, Ctrl+C, failed request: no Stop hook) heals after the window on the next tick', () => {
    let s = reduce(codex('idle'), promptSubmit, T0 + 1_000)
    s = reduce(s, title(IDLE), T0 + 2_000)
    expect(s.status).toBe('running')
    expect(reduce(s, { type: 'tick' }, T0 + 1_000 + CODEX_IDLE_HEAL_MS - 1).status).toBe('running')
    expect(reduce(s, { type: 'tick' }, T0 + 1_000 + CODEX_IDLE_HEAL_MS)).toMatchObject({ status: 'idle', currentAction: undefined })
  })

  it('an idle title that arrives after the window heals immediately', () => {
    const s = reduce(codex('idle'), promptSubmit, T0 + 1_000)
    expect(reduce(s, title(IDLE), T0 + 1_000 + CODEX_IDLE_HEAL_MS).status).toBe('idle')
  })

  it('a busy title keeps a running turn alive however long hooks stay quiet', () => {
    let s = reduce(codex('idle'), promptSubmit, T0 + 1_000)
    s = reduce(s, title(BUSY), T0 + 1_100)
    expect(reduce(s, { type: 'tick' }, T0 + 60_000).status).toBe('running')
  })

  it('a permission prompt held by the hook (spinner title) stays needs_you', () => {
    let s = reduce(codex('running'), notification('permission'), T0 + 1)
    s = reduce(s, title(BUSY), T0 + 30_000)
    expect(reduce(s, { type: 'tick' }, T0 + 60_000).status).toBe('needs_you')
  })

  it('an interrupted turn leaves needs_you once the title is idle and hooks are silent', () => {
    let s = reduce(codex('running'), notification('permission'), T0 + 1)
    s = reduce(s, title(IDLE), T0 + 2)
    expect(reduce(s, { type: 'tick' }, T0 + 1 + CODEX_IDLE_HEAL_MS).status).toBe('idle')
  })

  it('Action Required means Codex\'s own dialog is up: needs_you even without a hook', () => {
    const s = reduce(codex('running', '运行 ls'), title(ACTION), T0 + 100)
    expect(s).toMatchObject({ status: 'needs_you', currentAction: '等你确认：运行 ls', titleAction: true })
  })

  it('the blinking Action Required variants are one state', () => {
    let s = reduce(codex('running'), title(ACTION), T0 + 100)
    s = reduce(s, title('[ . ] Action Required | tr-codex-lab'), T0 + 1_100)
    expect(s.status).toBe('needs_you')
  })

  it('answering that dialog in the TUI (spinner returns) resumes running', () => {
    let s = reduce(codex('running', '运行 ls'), title(ACTION), T0 + 100)
    s = reduce(s, title(BUSY), T0 + 5_000)
    expect(s).toMatchObject({ status: 'running', currentAction: '运行 ls', titleAction: false })
  })

  it('cancelling it (title goes idle, turn interrupted) returns to idle', () => {
    let s = reduce(codex('running'), title(ACTION), T0 + 100)
    s = reduce(s, title(IDLE), T0 + 5_000)
    expect(s.status).toBe('idle')
  })

  it('a hook event settles an action-title wait', () => {
    let s = reduce(codex('running'), title(ACTION), T0 + 100)
    s = reduce(s, toolEnd(), T0 + 5_000)
    expect(s).toMatchObject({ status: 'running', titleAction: false })
  })

  it('does not disturb error or exited sessions', () => {
    expect(reduce(codex('error'), title(ACTION), T0 + 100).status).toBe('error')
    expect(reduce(codex('error'), title(BUSY), T0 + 60_000).status).toBe('error')
  })

  it('claude sessions ignore the codex rules', () => {
    expect(reduce(make('running'), title(ACTION), T0 + 100).status).toBe('running')
    expect(reduce(make('running'), { type: 'tick' }, T0 + CODEX_IDLE_HEAL_MS * 10).status).toBe('running')
  })
})
