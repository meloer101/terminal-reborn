import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { canReceive, freeBranch, previousRunActive, quotaBlock, sendStep, unchanged } from './model'

const session = (over: Partial<Session> = {}): Session => ({ id: 'x', worktreeId: 'w', kind: 'claude', title: 't', status: 'idle', startedAt: 0, lastActivityAt: 0, phase: 'ready', ...over })

describe('a due 定时任务', () => {
  it('is skipped while the account-wide limit is used up', () => {
    const resetsAt = new Date(2026, 10, 9, 11, 20).getTime()
    const usage = { vendor: 'codex' as const, at: 0, windows: [{ minutes: 300, percent: 100, resetsAt }, { minutes: 10080, scope: 'Sonnet', percent: 100 }] }
    expect(quotaBlock('Codex', usage, resetsAt - 1)).toBe('Codex 额度用完，11:20 恢复')
    expect(quotaBlock('Codex', usage, resetsAt + 1)).toBeNull()
    expect(quotaBlock('Codex', { ...usage, windows: [{ minutes: 300, percent: 80 }] }, 0)).toBeNull()
  })

  it('is skipped while its previous session still works or waits on the user', () => {
    const by = { id: 's1', name: 'n', planned: 0 }
    expect(previousRunActive([session({ scheduledBy: by, status: 'running' })], 's1')).toBe(true)
    expect(previousRunActive([session({ scheduledBy: by, status: 'done_unread' })], 's1')).toBe(false)
  })

  it('sends into an idle session, waits out a turn, skips one that waits on the user', () => {
    expect(sendStep(session(), false)).toEqual({ type: 'send' })
    expect(sendStep(session({ status: 'running' }), false)).toEqual({ type: 'wait' })
    expect(sendStep(session({ status: 'needs_you' }), false)).toEqual({ type: 'skip', reason: '会话在等你处理' })
    expect(sendStep(undefined, false)).toEqual({ type: 'fail', reason: '会话已关闭或归档' })
    expect(sendStep(session(), true)).toEqual({ type: 'fail', reason: '会话已关闭或归档' })
  })

  it('cannot write to a CLI read from its title, but can to its GUI session', () => {
    expect(canReceive(session({ kind: 'copilot' }))).toBe(false)
    expect(canReceive(session({ kind: 'copilot', ui: 'gui' }))).toBe(true)
    expect(canReceive(session({ kind: 'opencode' }))).toBe(true)
    expect(canReceive(session({ kind: 'shell' }))).toBe(false)
  })

  it('archives only a worktree with nothing changed, and never on an unknown status', () => {
    expect(unchanged({ dirtyCount: 0, ahead: 0 })).toBe(true)
    expect(unchanged({ dirtyCount: 1, ahead: 0 })).toBe(false)
    expect(unchanged({ dirtyCount: null, ahead: 0 })).toBe(false)
    expect(unchanged({ dirtyCount: 0, ahead: null })).toBe(false)
  })

  it('finds a free branch name', () => {
    expect(freeBranch('a', new Set())).toBe('a')
    expect(freeBranch('a', new Set(['a', 'a-2']))).toBe('a-3')
  })
})
