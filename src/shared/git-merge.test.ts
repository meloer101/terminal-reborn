import { describe, expect, it } from 'vitest'
import { mergeMessage, oneLine, operationInProgress, parseMergeRequest, parseMergeTree, squashMessage, trackedDirtyPaths } from './git-merge'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

describe('parseMergeTree', () => {
  it('takes the tree of a clean merge', () => {
    expect(parseMergeTree('57b76db8d5c0bd62fae19ce46bba606e51d5f3a7\n', false)).toEqual({ tree: '57b76db8d5c0bd62fae19ce46bba606e51d5f3a7', conflicts: [] })
  })

  it('names each conflicted path with its conflict type', () => {
    const out = [
      '57b76db8d5c0bd62fae19ce46bba606e51d5f3a7',
      'd.txt',
      'f.txt',
      '中文.txt',
      '',
      'CONFLICT (modify/delete): d.txt deleted in feat and modified in main.  Version main of d.txt left in tree.',
      'Auto-merging f.txt',
      'CONFLICT (content): Merge conflict in f.txt',
      'Auto-merging 中文.txt',
      'CONFLICT (content): Merge conflict in 中文.txt',
      ''
    ].join('\n')
    expect(parseMergeTree(out, true).conflicts).toEqual([
      { path: 'd.txt', type: 'modify/delete' },
      { path: 'f.txt', type: 'content' },
      { path: '中文.txt', type: 'content' }
    ])
  })

  it('does not match a path inside a longer one', () => {
    const out = ['t', 'a.ts', '', 'CONFLICT (add/add): Merge conflict in data.ts', 'CONFLICT (content): Merge conflict in a.ts'].join('\n')
    expect(parseMergeTree(out, true).conflicts).toEqual([{ path: 'a.ts', type: 'content' }])
  })
})

describe('messages', () => {
  it('merge subject like git', () => {
    expect(mergeMessage('jacob/x', 'main')).toBe("Merge branch 'jacob/x'")
    expect(mergeMessage('jacob/x', 'develop')).toBe("Merge branch 'jacob/x' into develop")
  })

  it('squash keeps a single commit message and lists several', () => {
    expect(squashMessage('b', [{ subject: 'fix', body: 'fix\n\ndetails\n' }])).toBe('fix\n\ndetails')
    expect(squashMessage('b', [{ subject: 'one', body: 'one' }, { subject: 'two', body: 'two' }])).toBe("Squash merge branch 'b'\n\n- one\n- two\n")
    expect(squashMessage('b', [{ subject: 'one', body: 'one' }, { subject: 'two', body: 'two' }], '标题')).toBe('标题\n\n- one\n- two\n')
  })

  it('oneLine strips control characters and newlines', () => {
    expect(oneLine(' a\n\tb\u001b[31m c ')).toBe('a b [31m c')
  })
})

describe('parseMergeRequest', () => {
  const valid = { root: '/r', worktree: '/w', method: 'squash', head: SHA_A, baseHead: SHA_B, push: false }

  it('accepts a well-formed request', () => {
    expect(parseMergeRequest(valid)).toEqual(valid)
    expect(parseMergeRequest({ ...valid, title: 'x\ny' })).toEqual({ ...valid, title: 'x y' })
  })

  it('rejects anything else', () => {
    expect(parseMergeRequest(null)).toBeNull()
    expect(parseMergeRequest({ ...valid, root: 'relative' })).toBeNull()
    expect(parseMergeRequest({ ...valid, method: 'octopus' })).toBeNull()
    expect(parseMergeRequest({ ...valid, head: '--force' })).toBeNull()
    expect(parseMergeRequest({ ...valid, push: 'yes' })).toBeNull()
    expect(parseMergeRequest({ ...valid, title: 3 })).toBeNull()
    expect(parseMergeRequest({ ...valid, message: 3 })).toBeNull()
    expect(parseMergeRequest({ ...valid, message: 'x'.repeat(10_001) })).toBeNull()
  })

  it('keeps the newlines of a squash message and cleans the rest', () => {
    const request = parseMergeRequest({ ...valid, message: 'feat: x  \r\n\r\nBody\u0007 line\n\n\n\n\n- a\n' })
    expect(request?.message).toBe('feat: x\n\nBody line\n\n\n- a')
    expect(parseMergeRequest({ ...valid, message: '  \n ' })).toEqual(valid)
    expect(parseMergeRequest({ ...valid, message: 'x'.repeat(10_000) })?.message).toHaveLength(10_000)
  })
})

describe('git state', () => {
  it('recognises an operation in progress', () => {
    expect(operationInProgress(['HEAD', 'rebase-merge'])).toBe('rebase')
    expect(operationInProgress(['MERGE_HEAD'])).toBe('merge')
    expect(operationInProgress(['CHERRY_PICK_HEAD'])).toBe('cherry-pick')
    expect(operationInProgress(['REVERT_HEAD'])).toBe('revert')
    expect(operationInProgress(['HEAD', 'index'])).toBeNull()
  })

  it('lists tracked dirty paths, renames with their source', () => {
    expect(trackedDirtyPaths(' M a.ts\0?? new.ts\0R  b.ts\0old.ts\0')).toEqual(['a.ts', 'b.ts', 'old.ts'])
    expect(trackedDirtyPaths('')).toEqual([])
  })
})
