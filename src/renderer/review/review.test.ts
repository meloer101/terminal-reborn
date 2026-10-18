import { describe, expect, it, vi } from 'vitest'

vi.mock('../lifecycle/agent-up', () => ({ ensureAgentUp: vi.fn() }))
vi.mock('../session-io', () => ({ submitPrompt: vi.fn() }))
vi.mock('../state/workspace', () => ({ useWorkspace: { getState: () => ({ sessions: [] }) } }))

const { reviewBlocker, reviewCommand } = await import('./review')

describe('reviewCommand', () => {
  it('maps each agent to its review command', () => {
    expect(reviewCommand('claude')).toBe('/code-review')
    expect(reviewCommand('codex')).toBe('/review')
    expect(reviewCommand('shell')).toBeNull()
  })
})

describe('reviewBlocker', () => {
  it('allows an idle or finished agent, and one that will be started again', () => {
    expect(reviewBlocker({ kind: 'claude', phase: 'ready', status: 'idle' })).toBeNull()
    expect(reviewBlocker({ kind: 'claude', phase: 'ready', status: 'done_unread' })).toBeNull()
    expect(reviewBlocker({ kind: 'codex', phase: 'exited', status: 'exited' })).toBeNull()
    expect(reviewBlocker({ kind: 'claude', phase: 'not-started', status: 'idle' })).toBeNull()
  })

  it('refuses a terminal, a busy agent and one that is not ready', () => {
    expect(reviewBlocker({ kind: 'shell', phase: undefined, status: 'idle' })).toBe('终端会话没有 agent')
    expect(reviewBlocker({ kind: 'claude', phase: 'ready', status: 'running' })).toMatch('正在运行')
    expect(reviewBlocker({ kind: 'claude', phase: 'ready', status: 'needs_you' })).toMatch('等你处理')
    expect(reviewBlocker({ kind: 'claude', phase: 'starting', status: 'idle' })).toMatch('正在启动')
    expect(reviewBlocker({ kind: 'claude', phase: 'blocked', status: 'idle' })).toMatch('提示')
  })
})
