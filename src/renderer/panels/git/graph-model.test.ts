import { describe, expect, it } from 'vitest'
import { buildPills, commitAge, laneColor, laneX, rowPaths, textLeft } from './graph-model'

describe('geometry', () => {
  it('matches the Figma 13B grid', () => {
    expect([0, 1, 5].map(laneX)).toEqual([18, 35, 103])
    // Six columns: the text column starts at 118.
    expect(textLeft(6)).toBe(118)
    expect(textLeft(0)).toBe(33)
  })

  it('colours the trunk neutral and cycles lane/1…5', () => {
    expect([0, 1, 5, 6, 10].map(laneColor)).toEqual([
      'var(--lane-main)',
      'var(--lane-1)',
      'var(--lane-5)',
      'var(--lane-1)',
      'var(--lane-5)'
    ])
  })

  it('draws straight lines, a fork turning into the node and a merge turning down', () => {
    const paths = rowPaths({ col: 0, through: [2], incoming: [0, 1], outgoing: [0, 3], width: 4 })
    expect(paths).toEqual([
      { d: 'M52 0V28', col: 2 },
      { d: 'M18 0V14', col: 0 },
      // From column 1 down, radius-8 turn left into the node at mid-row.
      { d: 'M35 0V6A8 8 0 0 1 27 14H18', col: 1 },
      { d: 'M18 14V28', col: 0 },
      // Out to the right, radius-8 turn down column 3.
      { d: 'M18 14H61A8 8 0 0 1 69 22V28', col: 3 }
    ])
  })

  it('turns the other way for lines on the left of the node', () => {
    const paths = rowPaths({ col: 2, through: [], incoming: [0], outgoing: [1], width: 3 })
    expect(paths).toEqual([
      { d: 'M18 0V6A8 8 0 0 0 26 14H52', col: 0 },
      { d: 'M52 14H43A8 8 0 0 0 35 22V28', col: 1 }
    ])
  })
})

describe('buildPills', () => {
  const refs = [
    { name: 'v1.0', kind: 'tag' as const, hash: 'a' },
    { name: 'origin/main', kind: 'remote' as const, hash: 'a' },
    { name: 'main', kind: 'local' as const, hash: 'a' },
    { name: 'jacob/nav', kind: 'local' as const, hash: 'b' },
    { name: 'idle-branch', kind: 'local' as const, hash: 'c' }
  ]
  const worktrees = [
    { path: '/repo', head: 'a', branch: 'main' },
    { path: '/wt/nav', head: 'b', branch: 'jacob/nav' },
    { path: '/wt/detached', head: 'c', branch: null },
    { path: '/wt/no-session', head: 'c', branch: 'idle-branch' }
  ]
  const sessions = new Map([
    ['/wt/nav', { sessionId: 's1', status: 'running' as const }],
    ['/wt/detached', { sessionId: 's2', status: 'needs_you' as const }]
  ])

  it('orders worktree · local · remote · tag and folds a worktree branch into its pill', () => {
    const pills = buildPills(refs, worktrees, sessions)
    expect(pills.get('a')).toEqual([
      { kind: 'local', name: 'main' },
      { kind: 'remote', name: 'origin/main' },
      { kind: 'tag', name: 'v1.0' }
    ])
    expect(pills.get('b')).toEqual([{ kind: 'worktree', name: 'jacob/nav', sessionId: 's1', status: 'running' }])
    // A detached worktree is named after its folder; a worktree without a session keeps its plain branch pill.
    expect(pills.get('c')).toEqual([
      { kind: 'worktree', name: 'detached', sessionId: 's2', status: 'needs_you' },
      { kind: 'local', name: 'idle-branch' }
    ])
  })
})

describe('commitAge', () => {
  const now = Date.UTC(2026, 9, 17)
  const ago = (ms: number) => commitAge(now, (now - ms) / 1000)
  it('reads like the sidebar times, extended to weeks, months and years', () => {
    expect(ago(20_000)).toBe('<1m')
    expect(ago(4 * 60_000)).toBe('4m')
    expect(ago(3 * 3600_000)).toBe('3h')
    expect(ago(2 * 86400_000)).toBe('2d')
    expect(ago(20 * 86400_000)).toBe('2w')
    expect(ago(90 * 86400_000)).toBe('3mo')
    expect(ago(800 * 86400_000)).toBe('2y')
    expect(commitAge(now, now / 1000 + 60)).toBe('<1m')
  })
})
