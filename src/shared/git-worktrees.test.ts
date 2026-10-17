import { describe, expect, it } from 'vitest'
import { isMergedInto, parseAheadBehind, parseBaseConfig, parseNumstat, parseWorktreePorcelain, pickMainBranch } from './git-worktrees'

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
      { path: '/repo', head: '1111111111111111111111111111111111111111', branch: 'main', bare: false, detached: false, locked: false, prunable: false },
      { path: '/wt/feature x', head: '2222222222222222222222222222222222222222', branch: 'jacob/feature', bare: false, detached: false, locked: true, prunable: false },
      { path: '/wt/detached', head: '3333333333333333333333333333333333333333', branch: null, bare: false, detached: true, locked: false, prunable: true },
      { path: '/repo.git', head: null, branch: null, bare: true, detached: false, locked: false, prunable: false }
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
  it('needs nothing ahead and a base that moved past HEAD', () => {
    expect(isMergedInto(0, 'a', 'b')).toBe(true)
    expect(isMergedInto(1, 'a', 'b')).toBe(false)
  })

  it('does not count a worktree that sits on the base tip (just forked)', () => {
    expect(isMergedInto(0, 'a', 'a')).toBe(false)
  })

  it('is false without a base', () => {
    expect(isMergedInto(null, 'a', null)).toBe(false)
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
