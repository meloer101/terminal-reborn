import { describe, expect, it } from 'vitest'
import type { GitChanges, GitFileChange } from '@shared/git-graph/log'
import type { ReviewComment } from '@shared/review-comments'
import type { DiffRow } from '@shared/git-graph/diff'
import type { PrThread } from '@shared/pull-requests'
import { changedSince, changeItems, changeKey, codeBetween, ITEM_HEIGHT, itemHeight, MAX_DIFF_LINES, noDiffReason, placedThreadIds, rowAnchor, splitAnchors, splitRows } from './changes-model'

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

  it('folds P2 / P3 review comments to their head line until opened (F13)', () => {
    const review = [note({ id: 'p1', origin: 'review', severity: 'P1' }), note({ id: 'p3', origin: 'review', severity: 'P3' })]
    const items = changeItems(data, open, diffs, review)
    const shown = items.filter((i) => i.kind === 'comment')
    expect(shown.map((i) => [i.comment.id, i.folded, itemHeight(i)])).toEqual([
      ['p1', false, ITEM_HEIGHT.comment],
      ['p3', true, ITEM_HEIGHT.commentFolded]
    ])
    const opened = changeItems(data, open, diffs, review, null, { p3: true }).filter((i) => i.kind === 'comment')
    expect(opened.map((i) => i.folded)).toEqual([false, false])
  })

  it('quotes the code of one side between two lines', () => {
    expect(codeBetween(rows, 'new', 1, 3)).toEqual(['a', 'B', 'c'])
    expect(codeBetween(rows, 'old', 2, 2)).toEqual(['b'])
    expect(rowAnchor(rows[0]!)).toBeNull()
  })
})

describe('splitRows (F5 并排)', () => {
  // Figma 17F: two removed lines replaced by six, context around them.
  const rows: DiffRow[] = [
    { kind: 'hunk', old: null, new: null, text: '@@ -24,10 +24,14 @@' },
    { kind: 'context', old: 24, new: 24, text: 'const ref = useRef()' },
    { kind: 'del', old: 25, new: null, text: 'const [offset, setOffset] = useState(0)' },
    { kind: 'add', old: null, new: 25, text: 'const [hidden, setHidden] = useState(false)' },
    { kind: 'context', old: 26, new: 26, text: '' },
    { kind: 'del', old: 27, new: null, text: 'useEffect(() => {' },
    { kind: 'del', old: 28, new: null, text: 'const onScroll = …' },
    { kind: 'add', old: null, new: 27, text: 'useEffect(() => {' },
    { kind: 'add', old: null, new: 28, text: 'const max = …' },
    { kind: 'add', old: null, new: 29, text: 'const onScroll = () => {' },
    { kind: 'add', old: null, new: 30, text: 'const y = …' },
    { kind: 'context', old: 29, new: 31, text: 'addEventListener(…)' }
  ]

  it('pairs a block’s removed and added lines in order and fills the shorter side', () => {
    const split = splitRows(rows)
    const shape = split.map((r) => (r.kind === 'hunk' ? 'hunk' : `${r.old?.old ?? '·'}|${r.new?.new ?? '·'}`))
    expect(shape).toEqual(['hunk', '24|24', '25|25', '26|26', '27|27', '28|28', '·|29', '·|30', '29|31'])
  })

  it('handles a pure deletion, a pure addition and a removal after additions', () => {
    const del: DiffRow = { kind: 'del', old: 1, new: null, text: 'a' }
    const add: DiffRow = { kind: 'add', old: null, new: 1, text: 'b' }
    expect(splitRows([del])).toEqual([{ kind: 'pair', old: del, new: null }])
    expect(splitRows([add])).toEqual([{ kind: 'pair', old: null, new: add }])
    expect(splitRows([add, del])).toEqual([
      { kind: 'pair', old: null, new: add },
      { kind: 'pair', old: del, new: null }
    ])
  })

  it('anchors comments to the removed line and to the new line', () => {
    const [, context, changed] = splitRows(rows)
    expect(splitAnchors(context!)).toEqual([{ side: 'new', line: 24 }])
    expect(splitAnchors(changed!)).toEqual([
      { side: 'old', line: 25 },
      { side: 'new', line: 25 }
    ])
    expect(splitAnchors({ kind: 'hunk', row: rows[0]! })).toEqual([])
  })

  it('lays a file out side by side with comments on the right half', () => {
    const key = changeKey('committed', 'nav.tsx')
    const comment: ReviewComment = { id: 'c1', group: 'committed', path: 'nav.tsx', side: 'new', line: 28, endLine: 28, text: 'ResizeObserver', code: '', createdAt: 1 }
    const items = changeItems(
      changes({ committed: [file('nav.tsx')] }),
      new Set([key]),
      { [key]: { kind: 'ready', binary: false, truncated: 0, rows } },
      [comment],
      null,
      {},
      'split'
    )
    const kinds = items.map((i) => i.kind)
    expect(kinds.filter((k) => k === 'split')).toHaveLength(9)
    expect(kinds).not.toContain('diff')
    const at = items.findIndex((i) => i.kind === 'comment')
    expect(items[at]).toMatchObject({ kind: 'comment', split: true })
    expect(items[at - 1]).toMatchObject({ kind: 'split', row: { kind: 'pair', new: { new: 28 } } })
    expect(itemHeight(items[at - 1]!)).toBe(ITEM_HEIGHT.split)
  })
})

describe('PR threads in the list (PRD F16 v1.63, Figma 22B)', () => {
  const rows = [
    { kind: 'hunk' as const, old: null, new: null, text: '@@ -1,3 +1,3 @@' },
    { kind: 'context' as const, old: 1, new: 1, text: 'a' },
    { kind: 'del' as const, old: 2, new: null, text: 'b' },
    { kind: 'add' as const, old: null, new: 2, text: 'B' }
  ]
  const data = changes({ committed: [file('a.ts')], uncommitted: [file('a.ts')] })
  const key = changeKey('committed', 'a.ts')
  const open = new Set([key])
  const diffs = { [key]: { kind: 'ready' as const, rows, binary: false, truncated: 0 } }
  const thread = (id: string, patch: Partial<PrThread> = {}): PrThread => ({ id, path: 'a.ts', line: 2, startLine: null, side: 'new', outdated: false, comments: [], ...patch })

  it('puts a thread under its line in 已提交, counts it on the file, and leaves the rest for the PR line', () => {
    const threads = [thread('T1'), thread('T2', { side: 'old' }), thread('T3', { line: 9 }), thread('T4', { outdated: true }), thread('T5', { path: 'b.ts' })]
    const items = changeItems(data, open, diffs, [], null, {}, 'unified', threads)
    const order = items.filter((i) => i.kind === 'diff' || i.kind === 'thread').map((i) => (i.kind === 'thread' ? i.thread.id : `${i.row.kind}${i.row.new ?? i.row.old ?? ''}`))
    expect(order).toEqual(['hunk', 'context1', 'del2', 'T2', 'add2', 'T1'])
    expect([...placedThreadIds(items)].sort()).toEqual(['T1', 'T2'])
    const fileItem = items.find((i) => i.kind === 'file' && i.group === 'committed')
    expect(fileItem).toMatchObject({ comments: 2 })
    // a.ts also has uncommitted edits: the thread may be about code that changed since.
    expect(items.find((i) => i.kind === 'thread')).toMatchObject({ changed: true })
    expect(itemHeight(items.find((i) => i.kind === 'thread')!)).toBe(ITEM_HEIGHT.thread)
  })
})
