import { describe, expect, it, vi } from 'vitest'
import type { GitChanges, GitFileChange } from '@shared/git-graph/log'
import type { ReviewComment } from '@shared/review-comments'
import { changeItems, changeKey } from '../panels/git/changes-model'

vi.mock('../state/review-comments', () => ({ useReviewComments: () => undefined }))

const { findMarkItem, markKey, marksByLine } = await import('./marks')

const comment = (id: string, patch: Partial<ReviewComment> = {}): ReviewComment => ({
  id,
  group: 'uncommitted',
  path: 'a.ts',
  side: 'new',
  line: 2,
  endLine: 3,
  code: '',
  text: 'x',
  createdAt: 0,
  severity: 'P1',
  origin: 'review',
  ...patch
})

describe('marksByLine', () => {
  it('keys the findings of a file by the side and line they start at, most severe first', () => {
    const marks = marksByLine(
      [
        comment('low', { severity: 'P3' }),
        comment('high', { severity: 'P0' }),
        comment('old', { side: 'old', line: 5, severity: 'P2' }),
        comment('other-file', { path: 'b.ts' }),
        comment('mine', { origin: undefined, severity: undefined }),
        comment('elsewhere', { line: 9 })
      ],
      'a.ts'
    )
    expect([...marks.keys()].sort()).toEqual([markKey('new', 2), markKey('new', 9), markKey('old', 5)].sort())
    expect(marks.get(markKey('new', 2))).toEqual([
      { commentId: 'high', severity: 'P0' },
      { commentId: 'low', severity: 'P3' }
    ])
    expect(marks.get(markKey('old', 5))).toEqual([{ commentId: 'old', severity: 'P2' }])
  })

  it('limits the marks to a group when asked, since line numbers differ between 未提交 and 已提交', () => {
    const list = [comment('u'), comment('c', { group: 'committed', line: 7 })]
    expect([...marksByLine(list, 'a.ts', 'committed').keys()]).toEqual([markKey('new', 7)])
    expect(marksByLine(list, 'a.ts').size).toBe(2)
  })

  it('has no marks without findings', () => {
    expect(marksByLine(undefined, 'a.ts').size).toBe(0)
    expect(marksByLine([], 'a.ts').size).toBe(0)
  })
})

describe('findMarkItem', () => {
  const file = (path: string): GitFileChange => ({ path, status: 'M', added: 1, removed: 1 })
  const rows = [
    { kind: 'hunk' as const, old: null, new: null, text: '@@ -1,2 +1,2 @@' },
    { kind: 'context' as const, old: 1, new: 1, text: 'a' },
    { kind: 'del' as const, old: 2, new: null, text: 'b' },
    { kind: 'add' as const, old: null, new: 2, text: 'B' }
  ]
  const data: GitChanges = { branch: 'w', base: 'main', baseRef: 'refs/heads/main', ahead: 1, behind: 0, uncommitted: [file('a.ts')], untrackedOmitted: 0, committed: [] }
  const key = changeKey('uncommitted', 'a.ts')
  const diffs = { [key]: { kind: 'ready' as const, rows, binary: false, truncated: 0 } }

  it('finds the diff line of a finding in the unified and the side-by-side list', () => {
    const unified = changeItems(data, new Set([key]), diffs)
    expect(unified[findMarkItem(unified, key, 'new', 2)]).toMatchObject({ kind: 'diff', row: { kind: 'add' } })
    expect(unified[findMarkItem(unified, key, 'old', 2)]).toMatchObject({ kind: 'diff', row: { kind: 'del' } })
    const split = changeItems(data, new Set([key]), diffs, [], null, 'split')
    expect(split[findMarkItem(split, key, 'new', 2)]).toMatchObject({ kind: 'split', row: { kind: 'pair', new: { new: 2 } } })
  })

  it('falls back to the file row when the line is not in the diff, and -1 when the file is not listed', () => {
    const items = changeItems(data, new Set([key]), diffs)
    expect(items[findMarkItem(items, key, 'new', 99)]).toMatchObject({ kind: 'file', key })
    expect(findMarkItem(items, changeKey('committed', 'a.ts'), 'new', 2)).toBe(-1)
  })
})
