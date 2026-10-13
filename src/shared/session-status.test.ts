import { describe, expect, it } from 'vitest'
import { compareByUrgency, needsAttention } from './session-status'
import type { Session, SessionStatus } from './types'

const session = (id: string, status: SessionStatus, lastActivityAt = 0): Session => ({
  id,
  worktreeId: 'w',
  kind: 'claude',
  title: id,
  status,
  startedAt: 0,
  lastActivityAt
})

describe('needsAttention', () => {
  it('flags needs_you, error and done_unread only', () => {
    const flagged = (['running', 'needs_you', 'done_unread', 'idle', 'error', 'exited'] as const).filter(
      needsAttention
    )
    expect(flagged).toEqual(['needs_you', 'done_unread', 'error'])
  })
})

describe('compareByUrgency', () => {
  it('puts needs_you first, then most recent activity', () => {
    const sorted = [
      session('a', 'running', 5),
      session('b', 'needs_you', 1),
      session('c', 'running', 9),
      session('d', 'idle', 10)
    ].sort(compareByUrgency)
    expect(sorted.map((s) => s.id)).toEqual(['b', 'c', 'a', 'd'])
  })
})
