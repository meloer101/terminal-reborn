import { describe, expect, it } from 'vitest'
import {
  isBaseRef,
  isValidRefName,
  parseLeftRight,
  parseLog,
  parseRawNumstat,
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

  it('ignores lines config adds before a record (log.showSignature)', () => {
    const out = `No signature\n${A}\x1f${B}\x1f2\x1fx\x1fsigned?\x1e\ngpg: Signature made …\ngpg: Good signature\n${B}\x1f\x1f1\x1fx\x1froot\x1e\n`
    expect(parseLog(out).map((c) => c.hash)).toEqual([A, B])
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
  it('falls back to origin/main or origin/master when origin/HEAD is not set', () => {
    expect(pickTrunk([...refs, { name: 'origin/master', kind: 'remote', hash: A }], null)).toEqual({ name: 'origin/master', hash: A })
  })
  it('gives up without a default branch', () => {
    expect(pickTrunk(refs, null)).toBeNull()
  })
})

describe('isValidRefName', () => {
  it('accepts what git accepts, unicode included', () => {
    for (const name of ['main', 'jacob/mobile-nav_2.1', 'origin/main', 'feature/登录', 'fix#12', 'a+b', 'v1.0-rc', 'x@y']) {
      expect(isValidRefName(name), name).toBe(true)
    }
  })
  it('rejects options, ranges and what check-ref-format refuses', () => {
    for (const name of ['', '-x', '--output=/tmp/x', 'a..b', 'a b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', 'a\\b', 'a@{1}', '@', '/a', 'a/', 'a//b', 'a.', '.a', 'a/.b', 'a.lock', 'a/b.lock/c', 'a\x01', 'x'.repeat(256)]) {
      expect(isValidRefName(name), JSON.stringify(name)).toBe(false)
    }
    expect(isValidRefName(42)).toBe(false)
  })
  it('accepts full base refs only under refs/heads and refs/remotes', () => {
    expect(isBaseRef('refs/heads/feature/登录')).toBe(true)
    expect(isBaseRef('refs/remotes/origin/main')).toBe(true)
    expect(isBaseRef('refs/tags/v1')).toBe(false)
    expect(isBaseRef('main')).toBe(false)
    expect(isBaseRef('refs/heads/a..b')).toBe(false)
    expect(isBaseRef('refs/heads/')).toBe(false)
  })
})

describe('changes', () => {
  it('reads one --raw --numstat -z diff: status, renames, binaries', () => {
    const out = [
      ':000000 100644 0000000 3e75765 A',
      'n.txt',
      ':100644 000000 45b983b 0000000 D',
      'y.txt',
      ':100644 100644 0fdf397 28c54b7 R070',
      'x.txt',
      'z.txt',
      ':100644 100644 1111111 2222222 M',
      'src/a.png',
      ':100644 100644 1111111 2222222 M',
      'app/[id]/page.tsx',
      '1\t0\tn.txt',
      '0\t1\ty.txt',
      '1\t0\t',
      'x.txt',
      'z.txt',
      '-\t-\tsrc/a.png',
      '3\t2\tapp/[id]/page.tsx',
      ''
    ].join('\0')
    expect(parseRawNumstat(out)).toEqual([
      { path: 'app/[id]/page.tsx', status: 'M', added: 3, removed: 2 },
      { path: 'n.txt', status: 'A', added: 1, removed: 0 },
      { path: 'src/a.png', status: 'M', added: null, removed: null },
      { path: 'y.txt', status: 'D', added: 0, removed: 1 },
      { path: 'z.txt', oldPath: 'x.txt', status: 'R', added: 1, removed: 0 }
    ])
    expect(parseRawNumstat('')).toEqual([])
  })

  it('reads ahead / behind', () => {
    expect(parseLeftRight('3\t5\n')).toEqual({ behind: 3, ahead: 5 })
    expect(parseLeftRight('')).toEqual({ behind: 0, ahead: 0 })
  })
})
