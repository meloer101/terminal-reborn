import { describe, expect, it } from 'vitest'
import {
  pairKey,
  parseRadarTargets,
  planRadar,
  radarMark,
  trackBase,
  wantsRebase,
  type RadarReport,
  type RadarWorktree
} from './conflict-radar'

describe('parseRadarTargets', () => {
  it('accepts absolute paths and defaults a bad stamp to 0', () => {
    expect(parseRadarTargets([{ root: '/r', worktree: '/r/w', stamp: 5 }, { root: '/r', worktree: '/w2', stamp: -1 }])).toEqual([
      { root: '/r', worktree: '/r/w', stamp: 5 },
      { root: '/r', worktree: '/w2', stamp: 0 }
    ])
  })

  it('refuses anything else', () => {
    expect(parseRadarTargets('x')).toBeNull()
    expect(parseRadarTargets([{ root: 'r', worktree: '/w' }])).toBeNull()
    expect(parseRadarTargets([{ root: '/r', worktree: '/w\0' }])).toBeNull()
    expect(parseRadarTargets([null])).toBeNull()
    expect(parseRadarTargets(Array.from({ length: 1001 }, () => ({ root: '/r', worktree: '/w' })))).toBeNull()
  })
})

describe('planRadar', () => {
  const node = (worktree: string, commit: string) => ({ worktree, commit, baseHead: 'base' })

  it('plans each node against its base and every pair once, in path order', () => {
    const { jobs } = planRadar([node('/c', 'cc'), node('/a', 'aa'), node('/b', 'bb')], () => false)
    expect(jobs.map((j) => (j.kind === 'base' ? `base ${j.worktree}` : `${j.a} ${j.b}`))).toEqual([
      'base /a',
      'base /b',
      'base /c',
      '/a /b',
      '/a /c',
      '/b /c'
    ])
  })

  it('n worktrees make n·(n−1)/2 pairs', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => node(`/w${String(i).padStart(2, '0')}`, `c${i}`))
    const { jobs } = planRadar(nodes, () => false)
    expect(jobs.filter((j) => j.kind === 'pair')).toHaveLength(190)
    expect(jobs.filter((j) => j.kind === 'base')).toHaveLength(20)
  })

  it('only what is not cached runs: one changed commit re-runs its base check and its n − 1 pairs', () => {
    const before = [node('/a', 'a1'), node('/b', 'b1'), node('/c', 'c1')]
    const cache = new Set(planRadar(before, () => false).jobs.map((j) => j.key))
    const { missing } = planRadar([node('/a', 'a1'), node('/b', 'b2'), node('/c', 'c1')], (key) => cache.has(key))
    expect(missing.map((j) => (j.kind === 'base' ? `base ${j.worktree}` : `${j.a} ${j.b}`))).toEqual(['base /b', '/a /b', '/b /c'])
  })

  it('keys do not depend on order, and the same commit twice is not a pair', () => {
    expect(pairKey('x', 'y')).toBe(pairKey('y', 'x'))
    expect(planRadar([node('/a', 'same'), node('/b', 'same')], () => false).jobs.filter((j) => j.kind === 'pair')).toEqual([])
  })
})

describe('trackBase', () => {
  it('flags a branch the base moved past while watched, until it is level again', () => {
    let track = trackBase(undefined, 'm1', 0)
    expect(track).toEqual({ level: 'm1', moved: false })
    track = trackBase(track, 'm2', 1)
    expect(track.moved).toBe(true)
    // Still behind after the base moves again: still flagged.
    track = trackBase(track, 'm3', 2)
    expect(track.moved).toBe(true)
    // Rebased.
    expect(trackBase(track, 'm3', 0)).toEqual({ level: 'm3', moved: false })
  })

  it('does not flag a branch that was already behind when first seen', () => {
    const first = trackBase(undefined, 'm1', 4)
    expect(trackBase(first, 'm1', 4).moved).toBe(false)
    expect(trackBase(first, 'm2', 5).moved).toBe(true)
  })
})

describe('radarMark', () => {
  const wt = (worktree: string, patch: Partial<RadarWorktree> = {}): RadarWorktree => ({
    worktree,
    branch: worktree.slice(1),
    base: 'main',
    ahead: 1,
    behind: 0,
    uncommitted: false,
    baseConflicts: [],
    baseMoved: false,
    ...patch
  })
  const report = (worktrees: RadarWorktree[], pairs: RadarReport['pairs'] = []): RadarReport => ({ root: '/r', state: 'ok', worktrees, pairs, checkedAt: 1 })
  const name = (path: string) => `jacob${path}`
  const conflict = (path: string) => ({ path, type: 'content' })

  it('names the other worktree, lists the files and notes uncommitted work', () => {
    const r = report([wt('/a', { uncommitted: true }), wt('/b')], [{ a: '/a', b: '/b', conflicts: [conflict('src/app.ts'), conflict('README.md')] }])
    const mark = radarMark(r, '/a', name)!
    expect(mark).toMatchObject({ tone: 'conflict', label: '和 jacob/b 会冲突' })
    expect(mark.detail).toBe('和 jacob/b 会冲突：src/app.ts、README.md\n含未提交的改动')
    expect(radarMark(r, '/b', name)!.label).toBe('和 jacob/a 会冲突')
  })

  it('counts several partners', () => {
    const r = report([wt('/a'), wt('/b'), wt('/c')], [
      { a: '/a', b: '/b', conflicts: [conflict('x')] },
      { a: '/a', b: '/c', conflicts: [conflict('y')] }
    ])
    expect(radarMark(r, '/a', name)!.label).toBe('和 jacob/b 等 2 个会冲突')
  })

  it('a conflict with the base, then a base that moved, then nothing', () => {
    const r = report([
      wt('/a', { behind: 2, baseMoved: true, baseConflicts: [conflict('app.txt')] }),
      wt('/b', { behind: 3, baseMoved: true }),
      wt('/c', { behind: 3 })
    ])
    const a = radarMark(r, '/a', name)!
    expect(a).toMatchObject({ tone: 'conflict', label: '和 main 会冲突' })
    expect(a.detail).toBe('合并到 main 会冲突：app.txt\nmain 已前进，a 落后 2 个提交')
    expect(radarMark(r, '/b', name)).toMatchObject({ tone: 'behind', label: 'main 已前进 · 落后 3' })
    // Behind since before Wavi looked: the Worktree view's 落后 count already says it.
    expect(radarMark(r, '/c', name)).toBeNull()
    expect(radarMark(r, '/missing', name)).toBeNull()
    expect(radarMark({ ...r, state: 'unsupported' }, '/a', name)).toBeNull()
    expect(radarMark(undefined, '/a', name)).toBeNull()
  })

  it('shortens long file lists', () => {
    const files = Array.from({ length: 12 }, (_, i) => conflict(`f${i}`))
    const mark = radarMark(report([wt('/a', { behind: 1, baseConflicts: files })]), '/a', name)!
    expect(mark.detail.split('\n')[0]).toBe('合并到 main 会冲突：f0、f1、f2、f3、f4、f5、f6、f7 等 12 个文件')
  })

  it('wantsRebase: behind, and the base moved or landing would conflict', () => {
    expect(wantsRebase(wt('/a', { behind: 1, baseMoved: true }))).toBe(true)
    expect(wantsRebase(wt('/a', { behind: 1, baseConflicts: [conflict('x')] }))).toBe(true)
    expect(wantsRebase(wt('/a', { behind: 1 }))).toBe(false)
    expect(wantsRebase(wt('/a', { behind: 0, baseMoved: true }))).toBe(false)
  })
})
