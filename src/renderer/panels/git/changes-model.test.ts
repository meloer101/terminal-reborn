import { describe, expect, it } from 'vitest'
import type { GitChanges, GitFileChange } from '@shared/git-graph/log'
import { changedSince, changeItems, changeKey, MAX_DIFF_LINES, noDiffReason } from './changes-model'

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
