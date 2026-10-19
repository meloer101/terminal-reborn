import { describe, expect, it } from 'vitest'
import { sessionIdsToStop, shouldRunArchiveScript } from './archive'

describe('shouldRunArchiveScript', () => {
  it('runs only an approved archive script and still lets the caller snapshot after a decline', () => {
    expect(shouldRunArchiveScript('approved')).toBe(true)
    expect(shouldRunArchiveScript('declined')).toBe(false)
    expect(shouldRunArchiveScript('none')).toBe(false)
  })
})

describe('sessionIdsToStop', () => {
  it('stops every session in the worktree, including one that is running', () => {
    const sessions = [
      { id: 's1', worktreeId: 'w1' },
      { id: 's2', worktreeId: 'w2' },
      { id: 's3', worktreeId: 'w1' }
    ]
    expect(sessionIdsToStop(sessions, 'w1')).toEqual(['s1', 's3'])
    expect(sessionIdsToStop(sessions, 'missing')).toEqual([])
  })
})
