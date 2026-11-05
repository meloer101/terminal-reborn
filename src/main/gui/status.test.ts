import { describe, expect, it } from 'vitest'
import { createGuiStatusTracker, toolInputOf } from './status'
import { initialState, reduce } from '@shared/session-state-machine'
import type { AgentEvent } from '@shared/agent-events'
import type { GuiEvent } from '@shared/gui-chat'

const tool = (id: string, name: string, arg: string, state: 'running' | 'ok' | 'error'): GuiEvent => ({
  type: 'items',
  changes: [{ index: 0, item: { kind: 'tool', id, at: 1, name, arg, state } }]
})

describe('toolInputOf', () => {
  it('puts the argument where current-action.ts looks for it', () => {
    expect(toolInputOf('Bash', 'npm test')).toEqual({ command: 'npm test' })
    expect(toolInputOf('Edit', 'src/a.ts')).toEqual({ file_path: 'src/a.ts' })
    expect(toolInputOf('Search', 'foo')).toEqual({ pattern: 'foo' })
    expect(toolInputOf('WebSearch', 'q')).toEqual({ query: 'q' })
    expect(toolInputOf('Tool', '')).toEqual({})
  })
})

describe('createGuiStatusTracker', () => {
  it('maps a turn: prompt submitted, a tool running and done, the reply, Stop', () => {
    const t = createGuiStatusTracker()
    expect(t.started('thr-1')).toEqual([{ type: 'session-start', agentSessionId: 'thr-1' }])
    expect(t.sent('hi')).toEqual([{ type: 'prompt-submit', prompt: 'hi' }])
    expect(t.events([tool('c1', 'Bash', 'ls', 'running')])).toEqual([{ type: 'tool-start', tool: 'Bash', input: { command: 'ls' } }])
    // The same row again (output grows) says nothing new.
    expect(t.events([tool('c1', 'Bash', 'ls', 'running')])).toEqual([])
    expect(t.events([tool('c1', 'Bash', 'ls', 'error')])).toEqual([{ type: 'tool-end', tool: 'Bash', input: { command: 'ls' }, ok: false }])
    expect(t.events([tool('c1', 'Bash', 'ls', 'error')])).toEqual([])
    t.events([{ type: 'items', changes: [{ index: 1, item: { kind: 'text', id: 't', at: 1, text: 'All done' } }] }])
    expect(t.turnEnd({ failed: false })).toEqual([{ type: 'stop', message: 'All done' }])
  })

  it('a tool that finishes without a running state still starts and ends', () => {
    const t = createGuiStatusTracker()
    expect(t.events([tool('e', 'Edit', 'a.ts', 'ok')]).map((e) => e.type)).toEqual(['tool-start', 'tool-end'])
  })

  it('permissions and questions are asks until answered', () => {
    const t = createGuiStatusTracker()
    const asked = t.events([{ type: 'prompt', prompt: { kind: 'permission', id: 'p1', tool: 'Bash', detail: 'rm -rf x', options: [] } }])
    expect(asked).toEqual([{ type: 'permission-request', tool: 'Bash', input: { command: 'rm -rf x' } }])
    // Sent again (a replay) it is still one ask.
    expect(t.events([{ type: 'prompt', prompt: { kind: 'permission', id: 'p1', tool: 'Bash', detail: 'rm -rf x', options: [] } }])).toEqual([])
    expect(t.events([{ type: 'prompt-done', id: 'p1' }])).toEqual([{ type: 'tool-end', tool: 'Bash', input: { command: 'rm -rf x' }, ok: true }])
    const q = t.events([{ type: 'prompt', prompt: { kind: 'question', id: 'q1', questions: [{ question: 'Which?', options: [], multiSelect: false }] } }])
    expect(q[0]).toMatchObject({ type: 'tool-start', tool: 'AskUserQuestion' })
    expect(t.events([{ type: 'prompt-done', id: 'unknown' }])).toEqual([])
  })

  it('a failed turn is a StopFailure with its message; exit ends the session', () => {
    const t = createGuiStatusTracker()
    expect(t.turnEnd({ failed: true, message: 'quota' })).toEqual([{ type: 'stop-failure', message: 'quota' }])
    expect(t.turnEnd({ failed: true })).toEqual([{ type: 'stop-failure' }])
    expect(t.exit()).toEqual([{ type: 'session-end', reason: 'exit' }])
  })

  it('drives the status machine through running → needs_you → running → done_unread', () => {
    const t = createGuiStatusTracker()
    let state = initialState('codex', 1000)
    let now = 1000
    const apply = (events: AgentEvent[]) => {
      for (const event of events) state = reduce(state, { type: 'event', event }, (now += 10))
    }
    apply(t.started('x'))
    apply(t.sent('do it'))
    expect(state.status).toBe('running')
    apply(t.events([tool('c1', 'Bash', 'npm test', 'running')]))
    expect(state.currentAction).toContain('npm test')
    apply(t.events([{ type: 'prompt', prompt: { kind: 'permission', id: 'p', tool: 'Bash', detail: 'npm test', options: [] } }]))
    expect(state.status).toBe('needs_you')
    apply(t.events([{ type: 'prompt-done', id: 'p' }]))
    expect(state.status).toBe('running')
    apply(t.events([tool('c1', 'Bash', 'npm test', 'ok')]))
    apply(t.turnEnd({ failed: false }))
    expect(state.status).toBe('done_unread')
    apply(t.exit())
    expect(state.status).toBe('exited')
  })
})
