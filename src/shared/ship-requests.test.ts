import { describe, expect, it } from 'vitest'
import { parseDiffSinceRequest, parseHandoffRequest, parsePushBaseRequest, parseShipMainRequest, parseShipOperationRequest } from './ship-requests'

const target = { root: '/r', worktree: '/w' }

describe('parseHandoffRequest', () => {
  it('accepts the three kinds', () => {
    for (const kind of ['commit', 'pr', 'fix']) expect(parseHandoffRequest({ ...target, kind })).toEqual({ ...target, kind })
  })

  it('rejects other kinds, inherited names and bad targets', () => {
    expect(parseHandoffRequest({ ...target, kind: 'other' })).toBeNull()
    expect(parseHandoffRequest({ ...target, kind: 'toString' })).toBeNull()
    expect(parseHandoffRequest({ ...target, kind: 3 })).toBeNull()
    expect(parseHandoffRequest({ root: 'rel', worktree: '/w', kind: 'pr' })).toBeNull()
    expect(parseHandoffRequest(null)).toBeNull()
    expect(parseHandoffRequest([target])).toBeNull()
  })
})

describe('parseDiffSinceRequest', () => {
  const sha = 'a'.repeat(40)

  it('accepts 7 to 40 hex characters and lowercases them', () => {
    expect(parseDiffSinceRequest({ ...target, since: sha })).toEqual({ ...target, since: sha })
    expect(parseDiffSinceRequest({ ...target, since: 'ABCDEF1' })).toEqual({ ...target, since: 'abcdef1' })
  })

  it('rejects anything git could read as something else', () => {
    for (const since of ['abc123', 'a'.repeat(41), '--force', 'HEAD', 'main..feat', 'abcdef1\n', '', 7, null]) {
      expect(parseDiffSinceRequest({ ...target, since })).toBeNull()
    }
    expect(parseDiffSinceRequest({ worktree: '/w', since: sha })).toBeNull()
  })
})

describe('parsePushBaseRequest', () => {
  it('takes a target and, optionally, the merge commit to push', () => {
    expect(parsePushBaseRequest({ root: '/r', worktree: '/w' })).toEqual({ root: '/r', worktree: '/w' })
    expect(parsePushBaseRequest({ root: '/r', worktree: '/w', commit: 'abc1234' })).toEqual({ root: '/r', worktree: '/w', commit: 'abc1234' })
    expect(parsePushBaseRequest({ root: '/r', worktree: '/w', commit: 'HEAD~1' })).toBeNull()
    expect(parsePushBaseRequest({ root: 'r', worktree: '/w' })).toBeNull()
  })
})

describe('parseShipMainRequest', () => {
  const valid = { ...target, message: 'feat: x', method: 'squash', paths: ['a.txt', 'src/b.ts'] }

  it('accepts a request with paths and keeps the message newlines', () => {
    expect(parseShipMainRequest(valid)).toEqual(valid)
    expect(parseShipMainRequest({ ...valid, message: 'feat: x  \r\n\r\nBody\n' })?.message).toBe('feat: x\n\nBody')
  })

  it('lets the message be empty only without paths', () => {
    expect(parseShipMainRequest({ ...valid, message: '', paths: null })).toEqual({ ...target, message: '', method: 'squash', paths: null })
    expect(parseShipMainRequest({ ...valid, message: ' \n' })).toBeNull()
  })

  it('reads an empty path list as nothing to commit and drops duplicates', () => {
    expect(parseShipMainRequest({ ...valid, paths: [] })?.paths).toBeNull()
    expect(parseShipMainRequest({ ...valid, paths: ['a', 'a'] })?.paths).toEqual(['a'])
    expect(parseShipMainRequest({ ...valid, paths: undefined })?.paths).toBeNull()
  })

  it('rejects bad methods, paths and oversized messages', () => {
    expect(parseShipMainRequest({ ...valid, method: 'octopus' })).toBeNull()
    expect(parseShipMainRequest({ ...valid, method: 7 })).toBeNull()
    for (const bad of ['/etc/passwd', '../x', 'a/../b', '', 'a\0b', 'a//b', './a']) expect(parseShipMainRequest({ ...valid, paths: [bad] })).toBeNull()
    expect(parseShipMainRequest({ ...valid, paths: 'a.txt' })).toBeNull()
    expect(parseShipMainRequest({ ...valid, message: 'x'.repeat(10_001) })).toBeNull()
    expect(parseShipMainRequest({ ...valid, message: 4 })).toBeNull()
    expect(parseShipMainRequest({ root: '/r', message: 'x', method: 'squash', paths: null })).toBeNull()
  })
})

describe('parseShipOperationRequest', () => {
  it('takes continue or abort on a worktree, nothing else', () => {
    expect(parseShipOperationRequest({ ...target, action: 'continue' })).toEqual({ ...target, action: 'continue' })
    expect(parseShipOperationRequest({ ...target, action: 'abort', extra: 1 })).toEqual({ ...target, action: 'abort' })
    expect(parseShipOperationRequest({ ...target, action: 'skip' })).toBeNull()
    expect(parseShipOperationRequest({ ...target })).toBeNull()
    expect(parseShipOperationRequest({ root: '/r', action: 'abort' })).toBeNull()
    expect(parseShipOperationRequest(null)).toBeNull()
  })

  it('carries force only as true (中止 after the user said yes)', () => {
    expect(parseShipOperationRequest({ ...target, action: 'abort', force: true })).toEqual({ ...target, action: 'abort', force: true })
    expect(parseShipOperationRequest({ ...target, action: 'abort', force: 'yes' })).toEqual({ ...target, action: 'abort' })
    expect(parseShipOperationRequest({ ...target, action: 'abort', force: false })).toEqual({ ...target, action: 'abort' })
  })
})
