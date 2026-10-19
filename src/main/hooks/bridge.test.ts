import { describe, expect, it } from 'vitest'
import type { AgentEventEnvelope, PendingPrompt, PromptResolution } from '@shared/agent-events'
import type { VendorUsage } from '@shared/session-meta'
import { HookBridge, type BridgeEmitter } from './bridge'
import { claudeFixtures as fx } from './fixtures'
import { type HookRequest, UnknownSessionError } from './server'

function setup(canDeliver = true, holdPermissions?: boolean) {
  const events: AgentEventEnvelope[] = []
  const prompts: PendingPrompt[] = []
  const resolutions: PromptResolution[] = []
  const usage: VendorUsage[] = []
  const emitter: BridgeEmitter = {
    event: (e) => events.push(e),
    prompt: (p) => prompts.push(p),
    resolved: (r) => resolutions.push(r),
    canDeliver: () => canDeliver,
    usage: (u) => usage.push(u)
  }
  const bridge = new HookBridge(emitter, { now: () => 1000, ...(holdPermissions === undefined ? {} : { holdPermissions }) })
  bridge.attach('s1')
  const req = (event: string, payload: unknown, sessionId = 's1', signal = new AbortController().signal): HookRequest => ({
    event,
    sessionId,
    agent: 'claude',
    payload,
    signal
  })
  return { bridge, events, prompts, resolutions, usage, req }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('HookBridge', () => {
  it('stamps events with session, agent and receive time', async () => {
    const { bridge, events, req } = setup()
    expect(await bridge.handle(req('UserPromptSubmit', fx.UserPromptSubmit))).toBe('')
    expect(events).toEqual([{ sessionId: 's1', agent: 'claude', at: 1000, event: { type: 'prompt-submit', prompt: 'Reply with only the word OK.' } }])
  })

  it('rejects sessions the app did not spawn', async () => {
    const { bridge, events, req } = setup()
    await expect(bridge.handle(req('Stop', fx.Stop, 'stranger'))).rejects.toBeInstanceOf(UnknownSessionError)
    expect(events).toEqual([])
  })

  it('holds a PermissionRequest until the UI answers, then returns the decision body', async () => {
    const { bridge, prompts, resolutions, req } = setup()
    let body: string | undefined
    void bridge.handle(req('PermissionRequest', fx.PermissionRequest_Bash)).then((b) => (body = b))
    await flush()
    expect(body).toBeUndefined()
    const prompt = prompts[0]
    expect(prompt).toMatchObject({
      kind: 'permission',
      sessionId: 's1',
      tool: 'Bash',
      summary: '运行 echo hooks-lab-ran > /work/project/ran.txt',
      canAllowAlways: true,
      allowAlways: { scope: 'session', rules: [], directories: ['/work/project'] },
      createdAt: 1000
    })
    expect(bridge.respondPermission(prompt!.id, 'allow-once')).toBe(true)
    await flush()
    expect(JSON.parse(body ?? '').hookSpecificOutput.decision).toEqual({ behavior: 'allow' })
    expect(resolutions).toEqual([{ id: prompt!.id, sessionId: 's1', by: 'gui' }])
  })

  it('without holds (the app since 10-16) announces the request and returns an empty body at once', async () => {
    const { bridge, prompts, req } = setup(true, false)
    expect(await bridge.handle(req('PermissionRequest', fx.PermissionRequest_Bash))).toBe('')
    expect(prompts).toMatchObject([{ kind: 'permission', tool: 'Bash' }])
    expect(bridge.pendingPermissions).toBe(0)
  })

  it('releases the hold with an empty body when the TUI prompt was answered (PostToolUse of the same call)', async () => {
    const { bridge, prompts, resolutions, req } = setup()
    const held = bridge.handle(req('PermissionRequest', fx.PermissionRequest_Bash))
    await bridge.handle(req('PostToolUse', fx.PostToolUse_Bash))
    expect(await held).toBe('')
    expect(resolutions).toEqual([{ id: prompts[0]!.id, sessionId: 's1', by: 'terminal' }])
  })

  it('a different tool finishing does not release the hold', async () => {
    const { bridge, prompts, resolutions, req } = setup()
    const held = bridge.handle(req('PermissionRequest', fx.PermissionRequest_Bash))
    await bridge.handle(req('PostToolUse', { tool_name: 'Read', tool_input: { file_path: '/x' } }))
    expect(resolutions).toEqual([])
    bridge.respondPermission(prompts[0]!.id, 'deny')
    expect(JSON.parse(await held).hookSpecificOutput.decision.behavior).toBe('deny')
  })

  it.each(['UserPromptSubmit', 'Stop', 'SessionEnd'] as const)('%s releases holds as answered in the terminal', async (event) => {
    const { bridge, resolutions, req } = setup()
    const held = bridge.handle(req('PermissionRequest', fx.PermissionRequest_Bash))
    await bridge.handle(req(event, fx[event]))
    expect(await held).toBe('')
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0]?.by).toBe('terminal')
  })

  it('the PTY exiting resolves holds and questions as session-ended', async () => {
    const { bridge, prompts, resolutions, req } = setup()
    const held = bridge.handle(req('PermissionRequest', fx.PermissionRequest_Bash))
    await bridge.handle(req('PreToolUse', fx.PreToolUse_AskUserQuestion))
    bridge.detach('s1')
    expect(await held).toBe('')
    expect(resolutions.map((r) => r.by).sort()).toEqual(['session-ended', 'session-ended'])
    expect(resolutions.map((r) => r.id).sort()).toEqual(prompts.map((p) => p.id).sort())
    await expect(bridge.handle(req('Stop', fx.Stop))).rejects.toBeInstanceOf(UnknownSessionError)
  })

  it('a dropped hook connection withdraws the prompt', async () => {
    const { bridge, resolutions, req } = setup()
    const abort = new AbortController()
    const held = bridge.handle(req('PermissionRequest', fx.PermissionRequest_Bash, 's1', abort.signal))
    abort.abort()
    expect(await held).toBe('')
    expect(resolutions[0]?.by).toBe('terminal')
  })

  it('does not hold the agent when no window can answer', async () => {
    const { bridge, prompts, req } = setup(false)
    expect(await bridge.handle(req('PermissionRequest', fx.PermissionRequest_Bash))).toBe('')
    expect(prompts).toEqual([])
  })

  it('passes AskUserQuestion permission requests straight through to the TUI', async () => {
    const { bridge, prompts, req } = setup()
    expect(await bridge.handle(req('PermissionRequest', fx.PermissionRequest_AskUserQuestion))).toBe('')
    expect(prompts).toEqual([])
  })

  it('AskUserQuestion: PreToolUse emits a question prompt, PostToolUse resolves it', async () => {
    const { bridge, prompts, resolutions, req } = setup()
    await bridge.handle(req('PreToolUse', fx.PreToolUse_AskUserQuestion))
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toMatchObject({ kind: 'question', sessionId: 's1', questions: [{ question: 'Which option do you prefer?', multiSelect: false }] })
    await bridge.handle(req('PostToolUse', fx.PostToolUse_AskUserQuestion))
    expect(resolutions).toEqual([{ id: prompts[0]!.id, sessionId: 's1', by: 'terminal' }])
  })

  it('a new question supersedes the previous one', async () => {
    const { bridge, prompts, resolutions, req } = setup()
    await bridge.handle(req('PreToolUse', fx.PreToolUse_AskUserQuestion))
    await bridge.handle(req('PreToolUse', fx.PreToolUse_AskUserQuestion))
    expect(prompts).toHaveLength(2)
    expect(resolutions).toEqual([{ id: prompts[0]!.id, sessionId: 's1', by: 'terminal' }])
  })

  it('unknown events are accepted and ignored', async () => {
    const { bridge, events, req } = setup()
    expect(await bridge.handle(req('SubagentStart', { agent_id: 'a' }))).toBe('')
    expect(events).toEqual([])
  })

  it('times out after 120 s into an empty body', async () => {
    const timers: Array<() => void> = []
    const emitted: PromptResolution[] = []
    const bridge = new HookBridge(
      { event: () => {}, prompt: () => {}, resolved: (r) => emitted.push(r), canDeliver: () => true },
      { scheduler: { setTimeout: (fn) => timers.push(fn), clearTimeout: () => {} } }
    )
    bridge.attach('s1')
    const held = bridge.handle({ event: 'PermissionRequest', sessionId: 's1', agent: 'claude', payload: fx.PermissionRequest_Bash, signal: new AbortController().signal })
    await flush()
    timers[0]?.()
    expect(await held).toBe('')
    expect(emitted[0]?.by).toBe('timeout')
  })
})

describe('HookBridge · agent titles', () => {
  it('shows every hook of an attached session to the title watcher and forgets it on detach', async () => {
    const calls: string[] = []
    const titles = {
      observe: (sessionId: string, agent: string, event: string) => void calls.push(`observe ${sessionId} ${agent} ${event}`),
      forget: (sessionId: string) => void calls.push(`forget ${sessionId}`)
    }
    const emitter: BridgeEmitter = { event: () => undefined, prompt: () => undefined, resolved: () => undefined, canDeliver: () => true }
    const bridge = new HookBridge(emitter, { titles })
    bridge.attach('s1')
    await bridge.handle({ event: 'Stop', sessionId: 's1', agent: 'claude', payload: {}, signal: new AbortController().signal })
    await expect(bridge.handle({ event: 'Stop', sessionId: 'nope', agent: 'claude', payload: {}, signal: new AbortController().signal })).rejects.toThrow()
    bridge.detach('s1')
    expect(calls).toEqual(['forget s1', 'observe s1 claude Stop', 'forget s1'])
  })
})

describe('HookBridge · session metrics (PRD F11 / F12)', () => {
  const statusLine = (percent: number | null, fiveHour = 13) => ({
    session_id: 'x',
    context_window: { used_percentage: percent, context_window_size: 200000, current_usage: percent === null ? null : { input_tokens: percent * 2000 } },
    rate_limits: { five_hour: { used_percentage: fiveHour, resets_at: 1792191000 } }
  })

  it('turns the statusLine into a context event (only on change) and account usage', async () => {
    const { bridge, events, req, usage } = setup()
    await bridge.handle(req('StatusLine', statusLine(null)))
    await bridge.handle(req('StatusLine', statusLine(62)))
    await bridge.handle(req('StatusLine', statusLine(62)))
    await bridge.handle(req('StatusLine', statusLine(63, 14)))
    expect(events.map((e) => e.event)).toEqual([
      { type: 'context', context: { percent: 62, usedTokens: 124000, windowTokens: 200000 } },
      { type: 'context', context: { percent: 63, usedTokens: 126000, windowTokens: 200000 } }
    ])
    expect(usage).toHaveLength(4)
    expect(usage[3]).toEqual({ vendor: 'claude', at: 1000, windows: [{ minutes: 300, percent: 14, resetsAt: 1792191000_000 }] })
  })

  it('keeps the todo list from PostToolUse and clears it (and the context) on /clear', async () => {
    const { bridge, events, req } = setup()
    const post = (tool_name: string, tool_input: unknown, tool_response?: unknown) => req('PostToolUse', { tool_name, tool_input, tool_response })
    await bridge.handle(req('StatusLine', statusLine(40)))
    await bridge.handle(post('TaskCreate', { subject: 'alpha' }, { task: { id: '1' } }))
    await bridge.handle(post('TaskUpdate', { taskId: '1', status: 'in_progress' }, { success: true }))
    await bridge.handle(post('TaskUpdate', { taskId: '9', status: 'completed' }, { success: true }))
    await bridge.handle(req('SessionStart', { session_id: 'abc', source: 'clear' }))
    await bridge.handle(req('SessionStart', { session_id: 'abc', source: 'clear' }))
    const meta = events.map((e) => e.event).filter((e) => e.type === 'todos' || e.type === 'context')
    expect(meta).toEqual([
      { type: 'context', context: { percent: 40, usedTokens: 80000, windowTokens: 200000 } },
      { type: 'todos', items: [{ id: '1', text: 'alpha', status: 'pending' }] },
      { type: 'todos', items: [{ id: '1', text: 'alpha', status: 'in_progress' }] },
      { type: 'todos', items: [] },
      { type: 'context', context: null }
    ])
  })

  it('applies readings taken outside hooks only for attached sessions', () => {
    const { bridge, events } = setup()
    bridge.applyReading('s1', 'codex', { context: { percent: 41 } })
    bridge.applyReading('stranger', 'codex', { context: { percent: 41 } })
    bridge.detach('s1')
    bridge.applyReading('s1', 'codex', { context: { percent: 42 } })
    expect(events.map((e) => [e.sessionId, e.event])).toEqual([['s1', { type: 'context', context: { percent: 41 } }]])
  })
})

describe('HookBridge · reattach', () => {
  it('replays the metrics to a window that adopted the same process, but not to a re-spawn', async () => {
    const { bridge, events, req } = setup()
    await bridge.handle(req('StatusLine', { context_window: { used_percentage: 30 } }))
    await bridge.handle(req('PostToolUse', { tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'a', status: 'pending' }] } }))
    events.length = 0
    bridge.attach('s1', { adopt: true })
    expect(events.map((e) => e.event.type)).toEqual(['context', 'todos'])
    events.length = 0
    bridge.attach('s1')
    bridge.attach('s1', { adopt: true })
    expect(events).toEqual([])
  })
})
