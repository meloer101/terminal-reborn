import { describe, expect, it, vi } from 'vitest'

vi.mock('./state/workspace', () => ({ useWorkspace: { getState: () => ({ sessions: [] }) } }))
vi.mock('./terminal/registry', () => ({ getSendIo: vi.fn(), readViewport: vi.fn() }))

const { passthroughAllowed } = await import('./session-io')

describe('passthroughAllowed', () => {
  it('blocks Ctrl+C only for an idle Codex session', () => {
    expect(passthroughAllowed({ kind: 'codex', status: 'idle' }, 'ctrl-c')).toBe(false)
    expect(passthroughAllowed({ kind: 'codex', status: 'done_unread' }, 'ctrl-c')).toBe(false)
    expect(passthroughAllowed({ kind: 'codex', status: 'running' }, 'ctrl-c')).toBe(true)
    expect(passthroughAllowed({ kind: 'codex', status: 'needs_you' }, 'ctrl-c')).toBe(true)
    expect(passthroughAllowed({ kind: 'codex', status: 'idle' }, 'escape')).toBe(true)
    expect(passthroughAllowed({ kind: 'claude', status: 'idle' }, 'ctrl-c')).toBe(true)
  })
})
