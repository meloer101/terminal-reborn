import { describe, expect, it } from 'vitest'
import type { GitFileChange } from './git-graph/log'
import {
  changeKey,
  changeStamp,
  fileStamp,
  MAX_MARKS_PER_WORKTREE,
  pruneMarks,
  reviewFiles,
  sanitizeReviewMarks,
  toggleViewed,
  viewedState,
  type ViewedMarks
} from './review-progress'

const change = (path: string, patch: Partial<GitFileChange> = {}): GitFileChange => ({ path, status: 'M', added: 3, removed: 1, ...patch })

describe('stamps', () => {
  it('joins status, line counts, size and mtime as main writes them', () => {
    expect(changeStamp({ status: 'M', added: 3, removed: 1, size: 120, mtimeMs: 1700000000123.4 })).toBe('M:3:1:120:1700000000123')
    expect(changeStamp({ status: 'D', added: null, removed: null, size: null, mtimeMs: null })).toBe('D:-:-:-:-')
  })

  it('uses main’s stamp, else status, line counts and where a rename came from', () => {
    expect(fileStamp(change('a.ts', { stamp: 'M:3:1:120:9' }))).toBe('M:3:1:120:9')
    expect(fileStamp(change('a.ts'))).toBe('M:3:1:')
    expect(fileStamp(change('b.ts', { status: 'R', oldPath: 'a.ts', added: null, removed: null }))).toBe('R:-:-:a.ts')
  })

  it('lists every row of 变更 with its key, 未提交 first', () => {
    const files = reviewFiles({ uncommitted: [change('a.ts')], committed: [change('a.ts', { stamp: 's' }), change('b.ts')] })
    expect(files).toEqual([
      { key: 'uncommitted:a.ts', stamp: 'M:3:1:' },
      { key: 'committed:a.ts', stamp: 's' },
      { key: 'committed:b.ts', stamp: 'M:3:1:' }
    ])
    expect(changeKey('committed', 'x/y.ts')).toBe('committed:x/y.ts')
  })
})

describe('viewedState', () => {
  const files = [
    { key: 'committed:a.ts', stamp: '1' },
    { key: 'committed:b.ts', stamp: '2' },
    { key: 'uncommitted:c.ts', stamp: '3' }
  ]

  it('counts the files whose mark still matches their diff', () => {
    const state = viewedState(files, { 'committed:a.ts': '1', 'committed:b.ts': 'old', 'committed:gone.ts': '9' })
    expect(state.viewed).toEqual(new Set(['committed:a.ts']))
    expect(state.stale).toEqual(new Set(['committed:b.ts']))
    expect(state.done).toBe(1)
    expect(state.total).toBe(3)
  })

  it('starts at nothing viewed', () => {
    expect(viewedState(files, {})).toMatchObject({ done: 0, total: 3 })
    expect(viewedState([], {})).toMatchObject({ done: 0, total: 0 })
  })
})

describe('toggleViewed', () => {
  it('marks a file at its current diff, and unmarks it', () => {
    const marked = toggleViewed({}, { key: 'committed:a.ts', stamp: '1' })
    expect(marked).toEqual({ 'committed:a.ts': '1' })
    expect(toggleViewed(marked, { key: 'committed:a.ts', stamp: '1' })).toEqual({})
  })

  it('marks again a file whose diff changed since', () => {
    expect(toggleViewed({ 'committed:a.ts': 'old' }, { key: 'committed:a.ts', stamp: 'new' })).toEqual({ 'committed:a.ts': 'new' })
  })

  it('does not change the marks it was given', () => {
    const marks: ViewedMarks = { 'committed:a.ts': '1' }
    toggleViewed(marks, { key: 'committed:b.ts', stamp: '2' })
    expect(marks).toEqual({ 'committed:a.ts': '1' })
  })
})

describe('pruneMarks', () => {
  const files = [{ key: 'committed:a.ts', stamp: '1' }]

  it('drops marks of files no longer in the change list', () => {
    expect(pruneMarks({ 'committed:a.ts': '1', 'committed:gone.ts': '2' }, files)).toEqual({ 'committed:a.ts': '1' })
  })

  it('keeps the mark of a file whose diff changed, so the row reads 看过后又改了', () => {
    const marks = { 'committed:a.ts': 'old' }
    expect(pruneMarks(marks, files)).toBe(marks)
    expect(viewedState(files, pruneMarks(marks, files)).stale).toEqual(new Set(['committed:a.ts']))
  })

  it('returns the same object when nothing goes (no store update)', () => {
    const marks = { 'committed:a.ts': '1' }
    expect(pruneMarks(marks, files)).toBe(marks)
  })
})

describe('sanitizeReviewMarks', () => {
  const worktrees = new Set(['/code/acme', '/code/acme-wt'])

  it('keeps the marks of worktrees that exist', () => {
    const raw = { '/code/acme': { 'committed:a.ts': 'M:1:0:-:-' }, '/elsewhere': { 'committed:a.ts': 'x' } }
    expect(sanitizeReviewMarks(raw, worktrees)).toEqual({ '/code/acme': { 'committed:a.ts': 'M:1:0:-:-' } })
  })

  it('reads a file without the field, and drops shapes it does not know', () => {
    expect(sanitizeReviewMarks(undefined, worktrees)).toEqual({})
    expect(sanitizeReviewMarks('junk', worktrees)).toEqual({})
    expect(sanitizeReviewMarks([{ '/code/acme': {} }], worktrees)).toEqual({})
    expect(sanitizeReviewMarks({ '/code/acme': ['committed:a.ts'] }, worktrees)).toEqual({})
    expect(
      sanitizeReviewMarks(
        { '/code/acme': { 'committed:a.ts': 3, 'other:a.ts': 'x', 'committed:': 'x', 'uncommitted:b\u0000.ts': 'x', 'uncommitted:c.ts': 'ok', 'committed:d.ts': 'y'.repeat(300) } },
        worktrees
      )
    ).toEqual({ '/code/acme': { 'uncommitted:c.ts': 'ok' } })
  })

  it('leaves out worktrees with no marks, and caps the marks per worktree', () => {
    expect(sanitizeReviewMarks({ '/code/acme': {} }, worktrees)).toEqual({})
    const many = Object.fromEntries(Array.from({ length: MAX_MARKS_PER_WORKTREE + 10 }, (_, i) => [`committed:f${i}.ts`, 's']))
    expect(Object.keys(sanitizeReviewMarks({ '/code/acme': many }, worktrees)['/code/acme']!)).toHaveLength(MAX_MARKS_PER_WORKTREE)
  })
})
