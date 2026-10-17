import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { glyphStatus, phaseLine } from './present'
import { issueFromSpawnError } from './launch-issues'

const session = (patch: Partial<Session> = {}): Session => ({
  id: 's',
  worktreeId: 'w',
  kind: 'claude',
  title: 'Cookie 会话迁移',
  status: 'idle',
  startedAt: 0,
  lastActivityAt: 0,
  ...patch
})

describe('presentation', () => {
  it('a starting agent shows the spinner glyph', () => {
    expect(glyphStatus(session({ phase: 'starting' }))).toBe('running')
    expect(glyphStatus(session({ phase: 'ready', status: 'needs_you' }))).toBe('needs_you')
  })

  it('sidebar lines per phase', () => {
    expect(phaseLine(session({ phase: 'starting' }))).toBe('正在启动 Claude Code…')
    expect(phaseLine(session({ phase: 'starting', kind: 'codex' }))).toBe('正在启动 Codex…')
    expect(phaseLine(session({ phase: 'not-started', agentSessionId: 'a' }))).toBe('未启动 · 点击恢复上次对话')
    expect(phaseLine(session({ phase: 'not-started' }))).toBe('未启动')
    expect(phaseLine(session({ phase: 'exited', status: 'exited' }))).toBe('Claude Code 已退出')
    expect(phaseLine(session({ phase: 'exited', status: 'error' }))).toBeUndefined()
    expect(phaseLine(session({ phase: 'ready' }))).toBeUndefined()
    expect(phaseLine(session())).toBeUndefined()
  })

})

describe('issueFromSpawnError', () => {
  it('reads the coded message through Electron\'s wrapping', () => {
    const wrapped = new Error("Error invoking remote method 'pty:spawn': Error: TR_CWD_MISSING:/Users/me/gone")
    expect(issueFromSpawnError(wrapped)).toEqual({ kind: 'cwd-missing', path: '/Users/me/gone' })
  })

  it('anything else is a spawn failure with its message', () => {
    expect(issueFromSpawnError(new Error('boom'))).toEqual({ kind: 'spawn-failed', message: 'boom' })
    expect(issueFromSpawnError('x')).toEqual({ kind: 'spawn-failed', message: 'x' })
  })
})
