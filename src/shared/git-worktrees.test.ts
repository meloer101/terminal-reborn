import { describe, expect, it } from 'vitest'
import {
  affectsWorktreeList,
  classifyRemoveError,
  hadOwnCommits,
  isMergedInto,
  mainWorktreeIndex,
  parseAheadBehind,
  parseBaseConfig,
  parseForEachRefAheadBehind,
  parseNumstat,
  parseRebaseHeadName,
  parseWorktreePorcelain,
  pickMainBranch
} from './git-worktrees'

describe('parseWorktreePorcelain', () => {
  it('reads every attribute of every entry', () => {
    const out = [
      'worktree /repo',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /wt/feature x',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/jacob/feature',
      'locked reason here',
      '',
      'worktree /wt/detached',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
      'worktree /repo.git',
      'bare',
      ''
    ].join('\n')
    expect(parseWorktreePorcelain(out)).toEqual([
      { path: '/repo', head: '1111111111111111111111111111111111111111', branch: 'main', bare: false, detached: false, locked: false, prunable: null },
      { path: '/wt/feature x', head: '2222222222222222222222222222222222222222', branch: 'jacob/feature', bare: false, detached: false, locked: true, prunable: null },
      { path: '/wt/detached', head: '3333333333333333333333333333333333333333', branch: null, bare: false, detached: true, locked: false, prunable: 'gitdir file points to non-existent location' },
      { path: '/repo.git', head: null, branch: null, bare: true, detached: false, locked: false, prunable: null }
    ])
  })

  it('treats the all-zero HEAD of an unborn branch as no commit', () => {
    expect(parseWorktreePorcelain('worktree /r\nHEAD 0000000000000000000000000000000000000000\nbranch refs/heads/main\n')[0]?.head).toBeNull()
  })

  it('returns nothing for empty output', () => {
    expect(parseWorktreePorcelain('')).toEqual([])
  })
})

describe('parseNumstat', () => {
  it('sums text files and skips binary ones', () => {
    expect(parseNumstat('3\t1\tsrc/a.ts\n10\t0\tsrc/b.ts\n-\t-\timg.png\n')).toEqual({ added: 13, removed: 1 })
  })

  it('is zero for a clean tree', () => {
    expect(parseNumstat('')).toEqual({ added: 0, removed: 0 })
  })
})

describe('parseAheadBehind', () => {
  it('reads left (base only) as behind and right (head only) as ahead', () => {
    expect(parseAheadBehind('5\t2\n')).toEqual({ behind: 5, ahead: 2 })
  })

  it('rejects anything else', () => {
    expect(parseAheadBehind('')).toBeNull()
    expect(parseAheadBehind('fatal: bad revision')).toBeNull()
  })
})

describe('isMergedInto', () => {
  it('needs nothing ahead and commits of its own', () => {
    expect(isMergedInto(0, true)).toBe(true)
    expect(isMergedInto(1, true)).toBe(false)
  })

  it('does not count a worktree that never committed (fresh, or the base moved on)', () => {
    expect(isMergedInto(0, false)).toBe(false)
  })

  it('is false without a base', () => {
    expect(isMergedInto(null, true)).toBe(false)
  })
})

describe('hadOwnCommits', () => {
  it('finds commits made on the branch in its reflog', () => {
    expect(hadOwnCommits('commit: fix nav\nbranch: Created from HEAD\n')).toBe(true)
    expect(hadOwnCommits('commit (amend): x\n')).toBe(true)
    expect(hadOwnCommits('cherry-pick: y\n')).toBe(true)
  })

  it('ignores creation, fast-forwards and resets; an empty reflog proves nothing', () => {
    expect(hadOwnCommits('merge main: Fast-forward\nreset: moving to main\nbranch: Created from HEAD\n')).toBe(false)
    expect(hadOwnCommits('')).toBe(false)
  })
})

describe('mainWorktreeIndex', () => {
  it('is the first entry, unless that is a bare repository', () => {
    expect(mainWorktreeIndex([{ bare: false }, { bare: false }])).toBe(0)
    expect(mainWorktreeIndex([{ bare: true }, { bare: false }])).toBeNull()
    expect(mainWorktreeIndex([])).toBeNull()
  })
})

describe('parseForEachRefAheadBehind', () => {
  it('reads "name\\0ahead behind" per branch', () => {
    expect(parseForEachRefAheadBehind('main\u00000 0\njacob/x\u00003 1\n')).toEqual({ main: { ahead: 0, behind: 0 }, 'jacob/x': { ahead: 3, behind: 1 } })
  })

  it('rejects output from a git without the atom', () => {
    expect(parseForEachRefAheadBehind('main\u0000%(ahead-behind:abc)\n')).toBeNull()
  })
})

describe('parseRebaseHeadName', () => {
  it('reads the branch a rebase works on', () => {
    expect(parseRebaseHeadName('refs/heads/jacob/x\n')).toBe('jacob/x')
    expect(parseRebaseHeadName('detached HEAD\n')).toBeNull()
  })
})

describe('classifyRemoveError', () => {
  it("recognises git's refusals; only submodules may be forced", () => {
    expect(classifyRemoveError('fatal: working trees containing submodules cannot be moved or removed')).toBe('submodules')
    expect(classifyRemoveError("fatal: '../x' contains modified or untracked files, use --force to delete it")).toBe('dirty')
    expect(classifyRemoveError('fatal: cannot remove a locked working tree;')).toBe('locked')
    expect(classifyRemoveError('fatal: detected dubious ownership in repository')).toBe('git')
  })
})

describe('affectsWorktreeList', () => {
  it('watches worktree entries, their HEADs, branch refs and packed-refs', () => {
    for (const path of ['worktrees', 'worktrees/x', 'worktrees/x/HEAD', 'refs/heads/jacob/x', 'packed-refs', 'HEAD']) {
      expect(affectsWorktreeList(path)).toBe(true)
    }
    for (const path of ['objects/ab/cdef', 'index', 'logs/HEAD', 'worktrees/x/index', 'refs/remotes/origin/main']) {
      expect(affectsWorktreeList(path)).toBe(false)
    }
  })
})

describe('pickMainBranch', () => {
  it("prefers origin's default branch when it exists locally", () => {
    expect(pickMainBranch(['main', 'trunk'], 'origin/trunk', 'main')).toBe('trunk')
  })

  it('falls back to main, then master, then the main checkout', () => {
    expect(pickMainBranch(['master', 'main'], 'origin/gone', null)).toBe('main')
    expect(pickMainBranch(['master'], null, 'dev')).toBe('master')
    expect(pickMainBranch(['dev'], null, 'dev')).toBe('dev')
    expect(pickMainBranch([], null, null)).toBeNull()
  })
})

describe('parseBaseConfig', () => {
  it('maps each branch to its recorded base, dots in names included', () => {
    expect(parseBaseConfig('branch.jacob/fix.base main\nbranch.v1.2.base refs/heads/release\n')).toEqual({
      'jacob/fix': 'main',
      'v1.2': 'release'
    })
  })
})
