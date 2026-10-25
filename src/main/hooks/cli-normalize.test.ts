import { describe, expect, it } from 'vitest'
import { normalizeHook } from './normalize'

describe('Gemini CLI hooks', () => {
  it('reads the conversation id, the prompt, the tools and the turn end', () => {
    expect(normalizeHook('gemini', 'SessionStart', { session_id: 'g-1', source: 'startup' }).events).toEqual([{ type: 'session-start', agentSessionId: 'g-1' }])
    expect(normalizeHook('gemini', 'BeforeAgent', { prompt: '改一下' })).toMatchObject({ events: [{ type: 'prompt-submit', prompt: '改一下' }], newTurn: true })
    expect(normalizeHook('gemini', 'BeforeTool', { tool_name: 'run_shell_command', tool_input: { command: 'npm test' } }).events).toEqual([
      { type: 'tool-start', tool: 'Bash', input: { command: 'npm test' } }
    ])
    expect(normalizeHook('gemini', 'AfterTool', { tool_name: 'replace', tool_input: { file_path: '/w/a.ts' }, tool_response: { error: 'no match' } }).events).toEqual([
      { type: 'tool-end', tool: 'Edit', input: { file_path: '/w/a.ts' }, ok: false }
    ])
    expect(normalizeHook('gemini', 'AfterAgent', { prompt_response: '好了' }).events).toEqual([{ type: 'stop', message: '好了' }])
  })

  it('takes a ToolPermission notification as its approval dialog being up (answered in the TUI, never held)', () => {
    const normalized = normalizeHook('gemini', 'Notification', {
      notification_type: 'ToolPermission',
      message: 'Allow?',
      details: { tool_name: 'write_file', tool_input: { file_path: '/w/b.ts' } }
    })
    expect(normalized.events).toEqual([{ type: 'permission-request', tool: 'Write', input: { file_path: '/w/b.ts' } }])
    expect(normalized.permission).toBeUndefined()
  })
})

describe('Qwen Code hooks', () => {
  it("reads Claude's event names with Gemini's tool names", () => {
    expect(normalizeHook('qwen', 'PreToolUse', { tool_name: 'edit', tool_input: { file_path: '/w/a.ts' } }).events).toEqual([
      { type: 'tool-start', tool: 'Edit', input: { file_path: '/w/a.ts' } }
    ])
    expect(normalizeHook('qwen', 'PostToolUseFailure', { tool_name: 'run_shell_command', tool_input: { command: 'make' } }).events).toEqual([
      { type: 'tool-end', tool: 'Bash', input: { command: 'make' }, ok: false }
    ])
    expect(normalizeHook('qwen', 'Notification', { notification_type: 'permission_prompt', message: 'x' }).events).toEqual([
      { type: 'notification', kind: 'permission', message: 'x' }
    ])
    expect(normalizeHook('qwen', 'Stop', { last_assistant_message: 'done' }).events).toEqual([{ type: 'stop', message: 'done' }])
  })

  it('never holds PermissionRequest: Qwen draws its dialog only after the hook returns', () => {
    const normalized = normalizeHook('qwen', 'PermissionRequest', { tool_name: 'run_shell_command', tool_input: { command: 'rm -rf build' } })
    expect(normalized.events).toEqual([{ type: 'permission-request', tool: 'Bash', input: { command: 'rm -rf build' } }])
    expect(normalized.permission).toBeUndefined()
  })
})

describe('Pi (Wavi extension)', () => {
  it('posts Claude-shaped events that read as they are', () => {
    expect(normalizeHook('pi', 'SessionStart', { session_id: '019a-2b', source: 'startup' }).events).toEqual([{ type: 'session-start', agentSessionId: '019a-2b' }])
    expect(normalizeHook('pi', 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }).events).toEqual([{ type: 'tool-start', tool: 'Bash', input: { command: 'ls' } }])
    expect(normalizeHook('pi', 'StopFailure', { error: 'overloaded' }).events).toEqual([{ type: 'stop-failure', message: 'overloaded', reason: 'overloaded' }])
  })
})
