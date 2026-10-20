import { describe, expect, it } from 'vitest'
import type { AgentEvent } from './agent-events'
import {
  ASK_SETTLE_MS,
  CODEX_IDLE_HEAL_MS,
  initialState,
  reduce,
  replyLine,
  CLAUDE_IDLE_HEAL_MS,
  NEEDS_YOU_HEAL_MS,
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
const permission = (tool: string, input: Record<string, unknown>, agentId?: string) =>
  ev({ type: 'permission-request', tool, input, ...(agentId ? { agentId } : {}) })
const subStart = (agentId: string, tool: string, input: Record<string, unknown> = {}) => ev({ type: 'tool-start', tool, input, agentId })
const subEnd = (agentId: string, tool: string, input: Record<string, unknown> = {}) => ev({ type: 'tool-end', tool, input, ok: true, agentId })
const toolEndOf = (tool: string, input: Record<string, unknown>) => ev({ type: 'tool-end', tool, input, ok: true })

/** Applies signals one millisecond apart from `at`. */
function run(state: SessionState, signals: Signal[], at = T0 + 10): SessionState {
  return signals.reduce((s, signal, i) => reduce(s, signal, at + i), state)
}

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
    // Claude sends idle_prompt only while its prompt is idle (no turn, no dialog, no background agent; PRD §6.6).
    ['idle notification ends a turn that lost its Stop', 'running', notification('idle'), 'idle'],
    ['idle notification ends a wait whose dialog went away', 'needs_you', notification('idle'), 'idle'],
    ['idle notification leaves an unread reply alone', 'done_unread', notification('idle'), 'done_unread'],
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

describe('turn and status times', () => {
  it('statusSince moves only when the status changes', () => {
    let s = reduce(make('idle'), promptSubmit, T0 + 1_000)
    expect(s.statusSince).toBe(T0 + 1_000)
    s = reduce(s, toolStart('Bash', { command: 'ls' }), T0 + 2_000)
    expect(s.statusSince).toBe(T0 + 1_000)
    s = reduce(s, notification('permission'), T0 + 3_000)
    expect(s.statusSince).toBe(T0 + 3_000)
    // Another notification is activity, not a new wait.
    s = reduce(s, notification('other'), T0 + 60_000)
    expect(s.statusSince).toBe(T0 + 3_000)
  })

  it('a turn starts on prompt-submit and survives answering a question', () => {
    let s = reduce(make('idle'), promptSubmit, T0 + 1_000)
    expect(s.turnStartedAt).toBe(T0 + 1_000)
    s = reduce(s, notification('permission'), T0 + 2_000)
    s = reduce(s, toolEnd(), T0 + 3_000)
    expect(s.status).toBe('running')
    expect(s.turnStartedAt).toBe(T0 + 1_000)
  })

  it('stop keeps the last reply line and the finish time; a new prompt clears the reply', () => {
    let s = reduce(make('running'), ev({ type: 'stop', message: 'Done.\n\n## Summary\n- **Fixed** the `auth` bug' }), T0 + 4_000)
    expect(s.lastReply).toBe('Fixed the auth bug')
    expect(s.finishedAt).toBe(T0 + 4_000)
    s = reduce(s, promptSubmit, T0 + 5_000)
    expect(s.lastReply).toBeUndefined()
    expect(s.finishedAt).toBe(T0 + 4_000)
  })
})

describe('replyLine', () => {
  it.each<[string | undefined, string | undefined]>([
    [undefined, undefined],
    ['', undefined],
    ['OK', 'OK'],
    ['First\nLast line  ', 'Last line'],
    ['Text\n\n---\n', 'Text'],
    ['1. step one\n2. **step two**', 'step two'],
    ['> quoted', 'quoted'],
    ['已经完成：修改了 3 个文件', '已经完成：修改了 3 个文件']
  ])('%j → %j', (input, expected) => {
    expect(replyLine(input)).toBe(expected)
  })

  it('clips long lines', () => {
    expect(replyLine('x'.repeat(200))).toBe(`${'x'.repeat(80)}…`)
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

// Known issue until 2026-10-20: two calls waiting on the user at once overwrote each other; answering the first
// turned the session back to running while the second dialog was still up. Every dialog is its own ask now.
describe('asks: several dialogs at once (PRD §3.1)', () => {
  const A = { url: 'https://a.example' }
  const B = { url: 'https://b.example' }

  it('two parallel permission requests keep needs_you until both are answered, in either order', () => {
    for (const order of [[A, B], [B, A]] as const) {
      let s = run(make('running'), [toolStart('WebFetch', A), toolStart('WebFetch', B), permission('WebFetch', A), permission('WebFetch', B)])
      expect(s).toMatchObject({ status: 'needs_you', currentAction: '等你确认：抓取 a.example（共 2 项）' })
      s = reduce(s, toolEndOf('WebFetch', order[0]), T0 + 30_000)
      expect(s.status).toBe('needs_you')
      expect(s.asks).toHaveLength(1)
      expect(s.currentAction).toBe(`等你确认：抓取 ${order[1] === A ? 'a' : 'b'}.example`)
      s = reduce(s, toolEndOf('WebFetch', order[1]), T0 + 40_000)
      expect(s.status).toBe('running')
      expect(s.asks).toEqual([])
    }
  })

  it('the same request twice is one ask', () => {
    const s = run(make('running'), [permission('Bash', { command: 'ls' }), permission('Bash', { command: 'ls' })])
    expect(s.asks).toHaveLength(1)
  })

  it('a PostToolUse whose input was rewritten still answers the oldest ask of its tool', () => {
    let s = run(make('running'), [permission('Bash', { command: 'ls' })])
    s = reduce(s, toolEndOf('Bash', { command: 'ls', description: 'list' }), T0 + 5_000)
    expect(s.status).toBe('running')
  })

  it('the Notification that follows a PermissionRequest (~6 s later) is the same dialog, not another ask', () => {
    let s = run(make('running'), [permission('Bash', { command: 'ls' })])
    s = reduce(s, notification('permission'), T0 + 6_000)
    expect(s.asks).toHaveLength(1)
    s = reduce(s, toolEndOf('Bash', { command: 'ls' }), T0 + 9_000)
    expect(s.status).toBe('running')
  })

  it('a call of the same batch starting right after an ask does not settle it; one started seconds later does', () => {
    let s = run(make('running'), [permission('WebFetch', A), toolStart('Grep', { pattern: 'x' })])
    expect(s.status).toBe('needs_you')
    // Denied with feedback: no PostToolUse, the agent carries on with its next call.
    s = reduce(s, toolStart('Read', { file_path: '/r.ts' }), T0 + 10 + ASK_SETTLE_MS + 1_000)
    expect(s).toMatchObject({ status: 'running', currentAction: '读取 r.ts', asks: [] })
  })

  it('plan approval (ExitPlanMode) waits on the user', () => {
    expect(reduce(make('running'), permission('ExitPlanMode', { plan: 'x' }), T0 + 1)).toMatchObject({ status: 'needs_you', currentAction: '等你确认：确认计划' })
  })

  it('a turn boundary ends the main thread\'s asks', () => {
    for (const signal of [promptSubmit, stop, ev({ type: 'stop-failure' }), ev({ type: 'session-end', reason: 'clear' })]) {
      const s = run(make('running'), [permission('Bash', { command: 'ls' }), signal])
      expect(s.asks).toEqual([])
      expect(s.status).not.toBe('needs_you')
    }
  })

  it('a dialog dismissed in the TUI (footer back, title idle) settles every ask', () => {
    const idleFooter: Signal = { type: 'screen', text: '❯ \n  ? for shortcuts' }
    let s = run(initialState('claude', T0, { status: 'running', phase: 'ready' }), [permission('Bash', { command: 'a' }), permission('Bash', { command: 'b' }), { type: 'title', title: '✳ Claude Code' }])
    s = reduce(s, idleFooter, T0 + 1_000)
    s = reduce(s, idleFooter, T0 + 1_000 + NEEDS_YOU_HEAL_MS)
    expect(s).toMatchObject({ status: 'idle', asks: [] })
  })
})

// Claude 2.1.304 marks hooks fired inside a subagent with `agent_id`. A subagent's work is not the main turn: it
// never starts or ends a turn (background agents run on after Stop); only its asks count.
describe('subagents and background agents', () => {
  it('a subagent asking while the main turn runs is needs_you; its answer returns to running', () => {
    let s = run(make('running'), [toolStart('Task', { description: '调查' }), subStart('w1', 'Bash', { command: 'make' }), permission('Bash', { command: 'make' }, 'w1')])
    expect(s).toMatchObject({ status: 'needs_you', currentAction: '等你确认：运行 make' })
    s = reduce(s, subEnd('w1', 'Bash', { command: 'make' }), T0 + 9_000)
    expect(s).toMatchObject({ status: 'running', currentAction: '子任务：调查' })
  })

  it('two subagents asking at once: answering one keeps needs_you for the other', () => {
    let s = run(make('running'), [permission('Bash', { command: 'a' }, 'w1'), permission('Bash', { command: 'b' }, 'w2')])
    s = reduce(s, subEnd('w1', 'Bash', { command: 'a' }), T0 + 9_000)
    expect(s).toMatchObject({ status: 'needs_you', currentAction: '等你确认：运行 b' })
    s = reduce(s, subEnd('w2', 'Bash', { command: 'b' }), T0 + 9_500)
    expect(s.status).toBe('running')
  })

  it('a subagent\'s calls never start a turn or bring back running after Stop', () => {
    let s = reduce(make('running'), stop, T0 + 1)
    expect(s.status).toBe('done_unread')
    const before = s
    s = run(s, [subStart('bg', 'Bash', { command: 'pnpm test' }), subEnd('bg', 'Bash', { command: 'pnpm test' })], T0 + 60_000)
    expect(s).toBe(before)
  })

  it('a background agent asking after the turn ended is needs_you, and goes back to the unread reply when answered', () => {
    let s = reduce(make('running'), ev({ type: 'stop', message: '已完成' }), T0 + 1)
    s = reduce(s, permission('Bash', { command: 'rm -rf dist' }, 'bg'), T0 + 30_000)
    expect(s).toMatchObject({ status: 'needs_you', currentAction: '等你确认：运行 rm -rf dist' })
    s = reduce(s, subEnd('bg', 'Bash', { command: 'rm -rf dist' }), T0 + 40_000)
    expect(s).toMatchObject({ status: 'done_unread', lastReply: '已完成' })
  })

  it('…or to idle if the user saw the reply meanwhile', () => {
    let s = reduce(make('running'), stop, T0 + 1)
    s = reduce(s, permission('Bash', { command: 'x' }, 'bg'), T0 + 2)
    s = reduce(s, { type: 'viewed' }, T0 + 3)
    expect(s.status).toBe('needs_you')
    s = reduce(s, ev({ type: 'subagent-stop', agentId: 'bg' }), T0 + 4)
    expect(s.status).toBe('idle')
  })

  it('Stop keeps a background agent\'s ask; a new prompt keeps it too', () => {
    let s = run(make('running'), [permission('Bash', { command: 'x' }, 'bg'), stop])
    expect(s).toMatchObject({ status: 'needs_you', asks: [{ agent: 'bg' }] })
    s = reduce(s, promptSubmit, T0 + 100)
    expect(s).toMatchObject({ status: 'needs_you', under: { status: 'running' } })
    s = reduce(s, subEnd('bg', 'Bash', { command: 'x' }), T0 + 200)
    expect(s.status).toBe('running')
  })

  it('SubagentStop drops that subagent\'s asks (it was denied, then finished)', () => {
    let s = run(make('running'), [permission('Bash', { command: 'x' }, 'w1'), permission('Bash', { command: 'y' }, 'w2')])
    s = reduce(s, ev({ type: 'subagent-stop', agentId: 'w1' }), T0 + 100)
    expect(s.asks).toMatchObject([{ agent: 'w2' }])
  })

  it('a subagent that carries on seconds after asking settles its own ask, not another one\'s', () => {
    let s = run(make('running'), [permission('Bash', { command: 'x' }, 'w1'), permission('Bash', { command: 'y' }, 'w2')])
    s = reduce(s, subStart('w1', 'Read', { file_path: '/a' }), T0 + 10 + ASK_SETTLE_MS + 500)
    expect(s.asks).toMatchObject([{ agent: 'w2' }])
    expect(s.status).toBe('needs_you')
  })

  it('the main thread moving on does not settle a subagent\'s ask', () => {
    let s = run(make('running'), [permission('Bash', { command: 'x' }, 'w1')])
    s = reduce(s, toolStart('Read', { file_path: '/a' }), T0 + 60_000)
    expect(s).toMatchObject({ status: 'needs_you', under: { status: 'running', action: '读取 a' } })
  })

  it('idle_prompt (sent only with no dialog up) settles everything, keeping an unread reply', () => {
    let s = run(make('running'), [stop, permission('Bash', { command: 'x' }, 'bg')])
    s = reduce(s, notification('idle'), T0 + 60_000)
    expect(s).toMatchObject({ status: 'done_unread', asks: [] })
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

// Hooks arrive in any order and some never arrive. Seeded random runs of a live Claude session — with parallel
// permission dialogs, subagents and background agents (`agent_id`) — must still settle: a Stop ends the main turn,
// a lost Stop heals from the idle title or idle_prompt, and needs_you holds exactly while some ask is pending
// (the "never stuck" half of PRD §3.1; the timed half is src/main/hooks/status-sim.test.ts).
describe('never stuck', () => {
  const CALLS = [
    { tool: 'Bash', input: { command: 'pnpm test' } },
    { tool: 'WebFetch', input: { url: 'https://a.example' } },
    { tool: 'WebFetch', input: { url: 'https://b.example' } }
  ]
  const AGENTS = ['w1', 'w2']
  const SIGNALS: Signal[] = [
    promptSubmit,
    toolStart('Bash', { command: 'pnpm test' }),
    toolStart('Edit', { file_path: '/repo/a.ts' }),
    toolEnd(),
    ...CALLS.flatMap((c) => [permission(c.tool, c.input), toolEndOf(c.tool, c.input)]),
    ...AGENTS.flatMap((a) => [
      subStart(a, 'Bash', { command: 'make' }),
      permission('Bash', { command: 'make' }, a),
      subEnd(a, 'Bash', { command: 'make' }),
      ev({ type: 'subagent-stop', agentId: a })
    ]),
    toolStart('AskUserQuestion', { questions: [{ question: '用哪个库？' }] }),
    ev({ type: 'tool-end', tool: 'AskUserQuestion', input: { questions: [{ question: '用哪个库？' }] }, ok: true }),
    notification('permission'),
    notification('question'),
    notification('idle'),
    ev({ type: 'session-start' }),
    ev({ type: 'session-end', reason: 'clear' }),
    ev({ type: 'stop-failure', message: 'API 额度已用完' }),
    stop,
    { type: 'viewed' },
    { type: 'unviewed' },
    { type: 'tick' },
    { type: 'title', title: '✳ Claude Code' },
    { type: 'title', title: '⠂ Claude Code' },
    { type: 'screen', text: '❯ \n  ? for shortcuts' },
    { type: 'screen', text: 'Do you want to proceed?\n❯ 1. Yes\n  2. No\n\nEsc to cancel' }
  ]
  const name = (signal: Signal): string => {
    if (signal.type !== 'event') return signal.type === 'title' ? `title:${signal.title[0]}` : signal.type
    const e = signal.event
    const agent = 'agentId' in e && e.agentId ? `@${e.agentId}` : ''
    const what = 'kind' in e ? `:${e.kind}` : 'tool' in e ? `:${e.tool}` : ''
    return `${e.type}${what}${agent}`
  }

  it('600 random runs: needs_you exactly while asks wait; Stop, idle_prompt and the idle title always settle', () => {
    let seed = 20261020
    const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31
    for (let run = 0; run < 600; run++) {
      let now = T0
      let state = reduce(initialState('claude', T0, { status: 'idle', phase: 'starting' }), ev({ type: 'session-start' }), now)
      const trail: string[] = []
      for (let i = 1 + Math.floor(random() * 50); i > 0; i--) {
        const signal = SIGNALS[Math.floor(random() * SIGNALS.length)] as Signal
        now += Math.floor(random() * 4_000)
        state = reduce(state, signal, now)
        trail.push(name(signal))
        const why = `run ${run}: ${trail.join(' → ')}`
        expect(state.status === 'needs_you', why).toBe(state.asks.length > 0)
        if (state.status === 'needs_you') expect(state.currentAction, why).toBeTruthy()
        // One ask per call and agent at most: nothing piles up.
        expect(state.asks.length, why).toBeLessThanOrEqual(CALLS.length + AGENTS.length + 2)
      }
      const why = `run ${run}: ${trail.join(' → ')}`
      // Stop ends the main turn; once every subagent is done too, nothing waits.
      const done = AGENTS.reduce((s, a, i) => reduce(s, ev({ type: 'subagent-stop', agentId: a }), now + 2 + i), reduce(state, stop, now + 1))
      expect(['idle', 'done_unread'], why).toContain(done.status)
      // Claude's idle_prompt comes only when nothing runs and no dialog is up.
      expect(['running', 'needs_you'], why).not.toContain(reduce(state, notification('idle'), now + 1).status)
      // A lost Stop: the idle title heals a running turn.
      const idleTitle = reduce(state, { type: 'title', title: '✳ Claude Code' }, now + 1)
      expect(reduce(idleTitle, { type: 'tick' }, now + 1 + CLAUDE_IDLE_HEAL_MS).status, why).not.toBe('running')
      // A dialog answered or dismissed in the TUI: the idle footer heals a wait.
      const footer: Signal = { type: 'screen', text: '❯ \n  ? for shortcuts' }
      const healed = reduce(reduce(idleTitle, footer, now + 2), footer, now + 2 + NEEDS_YOU_HEAL_MS + 2_000)
      expect(healed.status, why).not.toBe('needs_you')
    }
  })
})

describe('reattached after an app restart', () => {
  const restored = () => initialState('claude', T0, { status: 'idle', phase: 'not-started' })

  it('a not-started session ignores events until it is reattached, then follows them', () => {
    expect(reduce(restored(), promptSubmit, T0 + 1).status).toBe('idle')
    const up = reduce(restored(), { type: 'reattached', exited: false }, T0 + 1)
    expect(up).toMatchObject({ phase: 'ready', hooksSeen: true, status: 'idle' })
    expect(reduce(up, notification('permission'), T0 + 2).status).toBe('needs_you')
  })

  it('a terminal that ended meanwhile comes back exited', () => {
    expect(reduce(restored(), { type: 'reattached', exited: true }, T0 + 1)).toMatchObject({ phase: 'exited', status: 'exited', ended: true })
  })

  it('only moves a not-started session', () => {
    const running = reduce(reduce(restored(), { type: 'launch' }, T0 + 1), promptSubmit, T0 + 2)
    expect(reduce(running, { type: 'reattached', exited: true }, T0 + 3)).toBe(running)
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

// Codex titles (PRD §6.7): braille spinner = busy, `Action Required` = its own dialog, anything else = idle.
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
