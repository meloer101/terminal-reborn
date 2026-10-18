import { describe, expect, it } from 'vitest'
import type { GitChanges, GitFileChange } from '@shared/git-graph/log'
import type { ReviewComment } from '@shared/review-comments'
import { changedSince, changeItems, changeKey, codeBetween, MAX_DIFF_LINES, noDiffReason, rowAnchor } from './changes-model'

const file = (path: string, extra: Partial<GitFileChange> = {}): GitFileChange => ({ path, status: 'M', added: 1, removed: 1, ...extra })

const changes = (patch: Partial<GitChanges> = {}): GitChanges => ({
  branch: 'work',
  base: 'main',
  baseRef: 'refs/heads/main',
  ahead: 2,
  behind: 0,
  uncommitted: [],
  untrackedOmitted: 0,
  committed: [],
  ...patch
})

describe('noDiffReason', () => {
  it('skips nested repos, binaries and files too large to show', () => {
    expect(noDiffReason(file('a.ts'))).toBeNull()
    expect(noDiffReason(file('nested', { nested: true, added: null, removed: null }))).toBe('nested')
    expect(noDiffReason(file('big.log', { tooLarge: true, added: null, removed: null }))).toBe('large')
    expect(noDiffReason(file('a.png', { added: null, removed: null }))).toBe('binary')
    expect(noDiffReason(file('gen.ts', { added: MAX_DIFF_LINES, removed: 1 }))).toBe('large')
  })
})

describe('changedSince', () => {
  it('only refetches a diff whose counts or status moved', () => {
    expect(changedSince(file('a'), file('a'))).toBe(false)
    expect(changedSince(file('a'), file('a', { added: 2 }))).toBe(true)
    expect(changedSince(undefined, file('a'))).toBe(true)
  })
})

describe('changeItems', () => {
  it('lists groups and files, with diff rows under an open file', () => {
    const key = changeKey('committed', 'src/a.ts')
    const items = changeItems(
      changes({ uncommitted: [file('notes.md', { status: 'A', untracked: true })], committed: [file('src/a.ts')] }),
      new Set([key]),
      { [key]: { kind: 'ready', binary: false, truncated: 0, rows: [{ kind: 'add', old: null, new: 1, text: 'x' }] } }
    )
    expect(items.map((i) => i.kind)).toEqual(['group', 'file', 'group', 'file', 'diff'])
    expect(items[0]).toMatchObject({ title: '未提交', meta: '1 个文件' })
    expect(items[2]).toMatchObject({ title: '已提交', meta: '2 个提交 · 对比 main' })
  })

  it('says why a nested repo or a huge file has no diff, and counts untracked files left out', () => {
    const nested = changeKey('uncommitted', 'nested')
    const big = changeKey('uncommitted', 'big.log')
    const items = changeItems(
      changes({
        base: null,
        uncommitted: [file('big.log', { tooLarge: true, added: null, removed: null }), file('nested', { nested: true, added: null, removed: null })],
        untrackedOmitted: 3
      }),
      new Set([nested, big]),
      {}
    )
    expect(items.filter((i) => i.kind === 'note')).toEqual([
      { kind: 'note', key: big, text: '文件太大，用编辑器打开', open: 'big.log' },
      { kind: 'note', key: nested, text: '嵌套的 git 仓库，不显示 diff' },
      { kind: 'note', key: 'untracked-omitted', text: '还有 3 个未跟踪文件没有列出' }
    ])
    expect(items[0]).toMatchObject({ meta: '5 个文件' })
    expect(items.at(-1)).toMatchObject({ title: '已提交', meta: '没有可对比的基线分支' })
  })
})

describe('review comments in the list (F5)', () => {
  const rows = [
    { kind: 'hunk' as const, old: null, new: null, text: '@@ -1,3 +1,3 @@' },
    { kind: 'context' as const, old: 1, new: 1, text: 'a' },
    { kind: 'del' as const, old: 2, new: null, text: 'b' },
    { kind: 'add' as const, old: null, new: 2, text: 'B' },
    { kind: 'context' as const, old: 3, new: 3, text: 'c' }
  ]
  const data = changes({ uncommitted: [file('a.ts')] })
  const open = new Set([changeKey('uncommitted', 'a.ts')])
  const diffs = { [changeKey('uncommitted', 'a.ts')]: { kind: 'ready' as const, rows, binary: false, truncated: 0 } }
  const note = (patch: Partial<ReviewComment>): ReviewComment => ({
    id: 'c',
    group: 'uncommitted',
    path: 'a.ts',
    side: 'new',
    line: 2,
    endLine: 2,
    code: '',
    text: 'x',
    createdAt: 0,
    ...patch
  })
  const kinds = (items: ReturnType<typeof changeItems>) =>
    items.map((i) => (i.kind === 'diff' ? `${i.row.kind}${i.row.new ?? i.row.old ?? ''}` : i.kind === 'comment' ? `comment:${i.comment.id}` : i.kind))

  it('anchors each comment under its last line, on its side', () => {
    const items = changeItems(data, open, diffs, [note({ id: 'n2' }), note({ id: 'o2', side: 'old' }), note({ id: 'r', line: 1, endLine: 3 })])
    expect(kinds(items)).toEqual(['group', 'file', 'hunk', 'context1', 'del2', 'comment:o2', 'add2', 'comment:n2', 'context3', 'comment:r', 'group'])
    expect(items[1]).toMatchObject({ kind: 'file', comments: 3 })
  })

  it('puts the editor where a new comment goes, or in place of the one being edited', () => {
    const fresh = changeItems(data, open, diffs, [], { id: null, group: 'uncommitted', path: 'a.ts', side: 'new', endLine: 1 })
    expect(kinds(fresh)).toEqual(['group', 'file', 'hunk', 'context1', 'editor', 'del2', 'add2', 'context3', 'group'])
    const editing = changeItems(data, open, diffs, [note({ id: 'n2' })], { id: 'n2', group: 'uncommitted', path: 'a.ts', side: 'new', endLine: 2 })
    expect(kinds(editing)).toContain('editor')
    expect(kinds(editing)).not.toContain('comment:n2')
  })

  it('keeps comments whose line left the diff, after the file; a collapsed file only counts them', () => {
    const items = changeItems(data, open, diffs, [note({ id: 'gone', line: 99, endLine: 99 })])
    expect(kinds(items).slice(-2)).toEqual(['comment:gone', 'group'])
    const collapsed = changeItems(data, new Set(), diffs, [note({ id: 'n2' })])
    expect(kinds(collapsed)).toEqual(['group', 'file', 'group'])
    expect(collapsed[1]).toMatchObject({ comments: 1 })
  })

  it('quotes the code of one side between two lines', () => {
    expect(codeBetween(rows, 'new', 1, 3)).toEqual(['a', 'B', 'c'])
    expect(codeBetween(rows, 'old', 2, 2)).toEqual(['b'])
    expect(rowAnchor(rows[0]!)).toBeNull()
  })
})
