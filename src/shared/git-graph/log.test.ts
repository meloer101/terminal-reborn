import { describe, expect, it } from 'vitest'
import {
  isSafeRefName,
  mergeChanges,
  parseLeftRight,
  parseLog,
  parseNameStatus,
  parseNumstat,
  parseRefs,
  parseWorktreeList,
  pickTrunk,
  type GitRef
} from './log'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)

describe('parseLog', () => {
  it('reads hash, parents, time, author and subject', () => {
    const out = `${A}\x1f${B} ${C}\x1f1700000000\x1fJacob\x1fMerge branch 'x'\x1e\n${B}\x1f\x1f1690000000\x1fJacob\x1fInitial commit\x1e\n`
    expect(parseLog(out)).toEqual([
      { hash: A, parents: [B, C], time: 1700000000, author: 'Jacob', subject: "Merge branch 'x'" },
      { hash: B, parents: [], time: 1690000000, author: 'Jacob', subject: 'Initial commit' }
    ])
  })

  it('keeps unit separators out of subjects and skips junk', () => {
    expect(parseLog('')).toEqual([])
    expect(parseLog('not a commit\x1e')).toEqual([])
    expect(parseLog(`${A}\x1f\x1f1\x1f作者\x1f修复 · 中文说明\x1e`)[0]?.subject).toBe('修复 · 中文说明')
  })
})

describe('parseRefs', () => {
  it('splits local, remote and tags; peels annotated tags; drops origin/HEAD', () => {
    const out = [
      `${A}\0\0refs/heads/main`,
      `${B}\0\0refs/heads/jacob/nav`,
      `${A}\0\0refs/remotes/origin/HEAD`,
      `${A}\0\0refs/remotes/origin/main`,
      `${C}\0${A}\0refs/tags/v1.0`,
      `${B}\0\0refs/tags/light`,
      `${B}\0\0refs/stash`
    ].join('\n')
    expect(parseRefs(out)).toEqual([
      { name: 'main', kind: 'local', hash: A },
      { name: 'jacob/nav', kind: 'local', hash: B },
      { name: 'origin/main', kind: 'remote', hash: A },
      { name: 'v1.0', kind: 'tag', hash: A },
      { name: 'light', kind: 'tag', hash: B }
    ])
  })
})

describe('parseWorktreeList', () => {
  it('reads branches and detached heads, skipping bare and prunable entries', () => {
    const out = [
      'worktree /repo',
      `HEAD ${A}`,
      'branch refs/heads/main',
      '',
      'worktree /wt/nav',
      `HEAD ${B}`,
      'detached',
      '',
      'worktree /wt/gone',
      `HEAD ${C}`,
      'branch refs/heads/old',
      'prunable gitdir file points to non-existent location',
      '',
      'worktree /wt/new',
      `HEAD ${'0'.repeat(40)}`,
      'branch refs/heads/fresh',
      '',
      ''
    ].join('\0')
    expect(parseWorktreeList(out)).toEqual([
      { path: '/repo', head: A, branch: 'main' },
      { path: '/wt/nav', head: B, branch: null },
      { path: '/wt/new', head: null, branch: 'fresh' }
    ])
  })
})

describe('pickTrunk', () => {
  const refs: GitRef[] = [
    { name: 'develop', kind: 'local', hash: B },
    { name: 'origin/develop', kind: 'remote', hash: C }
  ]
  it('prefers a local main or master', () => {
    expect(pickTrunk([...refs, { name: 'master', kind: 'local', hash: A }], null)).toEqual({ name: 'master', hash: A })
  })
  it('falls back to what origin/HEAD names, local branch first', () => {
    expect(pickTrunk(refs, 'refs/remotes/origin/develop')).toEqual({ name: 'develop', hash: B })
    expect(pickTrunk(refs.slice(1), 'refs/remotes/origin/develop')).toEqual({ name: 'origin/develop', hash: C })
  })
  it('gives up without a default branch', () => {
    expect(pickTrunk(refs, null)).toBeNull()
  })
})

describe('isSafeRefName', () => {
  it('accepts branch names and rejects options and ranges', () => {
    expect(isSafeRefName('main')).toBe(true)
    expect(isSafeRefName('jacob/mobile-nav_2.1')).toBe(true)
    expect(isSafeRefName('origin/main')).toBe(true)
    expect(isSafeRefName('--output=/tmp/x')).toBe(false)
    expect(isSafeRefName('-x')).toBe(false)
    expect(isSafeRefName('a..b')).toBe(false)
    expect(isSafeRefName('a b')).toBe(false)
    expect(isSafeRefName('')).toBe(false)
    expect(isSafeRefName(42)).toBe(false)
  })
})

describe('changes', () => {
  it('joins name-status and numstat, renames and binaries included', () => {
    const status = parseNameStatus('A\0n.txt\0D\0y.txt\0R070\0x.txt\0z.txt\0M\0src/a.ts\0')
    const numstat = parseNumstat('1\t0\tn.txt\x000\t1\ty.txt\x001\t0\t\0x.txt\0z.txt\0-\t-\tsrc/a.ts\0')
    expect(mergeChanges(status, numstat)).toEqual([
      { path: 'n.txt', status: 'A', added: 1, removed: 0 },
      { path: 'src/a.ts', status: 'M', added: null, removed: null },
      { path: 'y.txt', status: 'D', added: 0, removed: 1 },
      { path: 'z.txt', oldPath: 'x.txt', status: 'R', added: 1, removed: 0 }
    ])
  })

  it('reads ahead / behind', () => {
    expect(parseLeftRight('3\t5\n')).toEqual({ behind: 3, ahead: 5 })
    expect(parseLeftRight('')).toEqual({ behind: 0, ahead: 0 })
  })
})
