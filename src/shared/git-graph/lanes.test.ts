import { describe, expect, it } from 'vitest'
import { initialLaneState, layoutRows, type GraphCommitInput, type GraphRow } from './lanes'

/** `c('b', 'a')` = commit b with parent a. */
const c = (hash: string, ...parents: string[]): GraphCommitInput => ({ hash, parents })

const cols = (rows: GraphRow[]) => rows.map((r) => r.col)

/** Lines leaving the bottom of each row must be exactly the lines entering the top of the next one. */
function expectContinuous(rows: GraphRow[]): void {
  for (let i = 0; i + 1 < rows.length; i++) {
    const bottom = new Set([...rows[i]!.through, ...rows[i]!.outgoing])
    const top = new Set([...rows[i + 1]!.through, ...rows[i + 1]!.incoming])
    expect([...top].sort(), `row ${i} → ${i + 1}`).toEqual([...bottom].sort())
  }
}

describe('layoutRows', () => {
  it('draws a linear history in one column', () => {
    const { rows } = layoutRows([c('c', 'b'), c('b', 'a'), c('a')], initialLaneState())
    expect(rows).toEqual([
      { col: 0, through: [], incoming: [], outgoing: [0], width: 1 },
      { col: 0, through: [], incoming: [0], outgoing: [0], width: 1 },
      { col: 0, through: [], incoming: [0], outgoing: [], width: 1 }
    ])
  })

  it('forks: a branch line turns into its parent node at the parent row', () => {
    // main: m2 → base; feature: f1 → base
    const { rows } = layoutRows([c('f1', 'base'), c('m2', 'base'), c('base')], initialLaneState())
    expect(cols(rows)).toEqual([0, 1, 0])
    expect(rows[1]).toMatchObject({ through: [0], incoming: [], outgoing: [1] })
    expect(rows[2]).toMatchObject({ col: 0, incoming: [0, 1], outgoing: [] })
    expectContinuous(rows)
  })

  it('keeps the trunk in column 0 even when a branch is newer', () => {
    const { rows } = layoutRows([c('f1', 'base'), c('m2', 'base'), c('base')], initialLaneState('m2'))
    expect(cols(rows)).toEqual([1, 0, 0])
    // Nothing is drawn in the reserved column above the trunk tip.
    expect(rows[0]).toMatchObject({ through: [], incoming: [], outgoing: [1], width: 2 })
    expect(rows[1]).toMatchObject({ col: 0, through: [1], incoming: [], outgoing: [0] })
    expect(rows[2]).toMatchObject({ col: 0, incoming: [0, 1] })
    expectContinuous(rows)
  })

  it('merges: the second parent leaves the merge row sideways and runs down its own column', () => {
    // M merges feature (f2 → f1 → base) into main (m1 → base)
    const commits = [c('M', 'm1', 'f2'), c('f2', 'f1'), c('m1', 'base'), c('f1', 'base'), c('base')]
    const { rows } = layoutRows(commits, initialLaneState('M'))
    expect(cols(rows)).toEqual([0, 1, 0, 1, 0])
    expect(rows[0]).toMatchObject({ incoming: [], outgoing: [0, 1] })
    expect(rows[1]).toMatchObject({ through: [0], incoming: [1], outgoing: [1] })
    expect(rows[4]).toMatchObject({ incoming: [0, 1], outgoing: [] })
    expectContinuous(rows)
  })

  it('reuses an existing lane when the merged parent is already expected', () => {
    // Both a branch tip and the merge point at p.
    const commits = [c('t', 'p'), c('M', 'm', 'p'), c('p', 'root'), c('m', 'root'), c('root')]
    const { rows } = layoutRows(commits, initialLaneState())
    expect(cols(rows)).toEqual([0, 1, 0, 1, 0])
    expect(rows[1]!.outgoing).toEqual([1, 0])
    expectContinuous(rows)
  })

  it('lays out an octopus merge with one new column per extra parent', () => {
    const commits = [c('O', 'a', 'b', 'c'), c('c', 'r'), c('b', 'r'), c('a', 'r'), c('r')]
    const { rows } = layoutRows(commits, initialLaneState())
    expect(rows[0]).toMatchObject({ col: 0, outgoing: [0, 1, 2], width: 3 })
    expect(cols(rows)).toEqual([0, 2, 1, 0, 0])
    expect(rows[4]).toMatchObject({ incoming: [0, 1, 2] })
    expectContinuous(rows)
  })

  it('frees a column when its branch ends and reuses it for the next one', () => {
    // f joins main at b; g starts later and takes the freed column 1.
    const commits = [c('f', 'b'), c('a', 'b'), c('b', 'x'), c('g', 'x'), c('x', 'y'), c('y')]
    const { rows, state } = layoutRows(commits, initialLaneState('a'))
    expect(cols(rows)).toEqual([1, 0, 0, 1, 0, 0])
    expect(rows[2]!.width).toBe(2)
    expect(rows[5]!.width).toBe(1)
    expect(state.lanes).toEqual([])
    expectContinuous(rows)
  })

  it('merging the trunk tip in from above starts the trunk line at the merge', () => {
    // A branch merged main (m) into itself before m shows up in topo order.
    const commits = [c('B', 'f', 'm'), c('f', 'r'), c('m', 'r'), c('r')]
    const { rows } = layoutRows(commits, initialLaneState('m'))
    expect(cols(rows)).toEqual([1, 1, 0, 0])
    expect(rows[0]).toMatchObject({ outgoing: [1, 0] })
    expect(rows[1]).toMatchObject({ through: [0] })
    expect(rows[2]).toMatchObject({ incoming: [0] })
    expectContinuous(rows)
  })

  it('handles many parallel branches without losing a line', () => {
    const tips = Array.from({ length: 12 }, (_, i) => c(`t${i}`, 'root'))
    const { rows } = layoutRows([...tips, c('root')], initialLaneState())
    expect(cols(rows)).toEqual([...Array.from({ length: 12 }, (_, i) => i), 0])
    expect(rows[11]!.width).toBe(12)
    expect(rows[12]!.incoming).toEqual(Array.from({ length: 12 }, (_, i) => i))
    expectContinuous(rows)
  })

  it('is incremental: two pages give the same rows as one', () => {
    const commits = [
      c('M2', 'M1', 'h2'),
      c('h2', 'h1'),
      c('M1', 'm0', 's1'),
      c('h1', 'm0'),
      c('s1', 'm0'),
      c('m0', 'root'),
      c('t', 'root'),
      c('root')
    ]
    const whole = layoutRows(commits, initialLaneState('M2'))
    for (let split = 0; split <= commits.length; split++) {
      const first = layoutRows(commits.slice(0, split), initialLaneState('M2'))
      const second = layoutRows(commits.slice(split), first.state)
      expect([...first.rows, ...second.rows]).toEqual(whole.rows)
      expect(second.state).toEqual(whole.state)
    }
    expectContinuous(whole.rows)
  })

  it('does not mutate the state it is given', () => {
    const state = initialLaneState('a')
    const snapshot = structuredClone(state)
    layoutRows([c('b', 'a'), c('a')], state)
    expect(state).toEqual(snapshot)
  })

  it('leaves lines open at the end of a page for parents that come later', () => {
    const { rows, state } = layoutRows([c('M', 'a', 'b')], initialLaneState())
    expect(rows[0]!.outgoing).toEqual([0, 1])
    expect(state.lanes).toEqual(['a', 'b'])
  })

  it('stays continuous on a random history', () => {
    // Deterministic pseudo-random DAG in topo order (children before parents).
    let seed = 7
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const n = 300
    const commits: GraphCommitInput[] = []
    for (let i = 0; i < n; i++) {
      const parents: string[] = []
      if (i < n - 1) {
        parents.push(`c${i + 1 + Math.floor(rand() * Math.min(5, n - i - 1))}`)
        if (rand() < 0.25 && i < n - 2) {
          const extra = `c${i + 1 + Math.floor(rand() * Math.min(20, n - i - 1))}`
          if (!parents.includes(extra)) parents.push(extra)
        }
      }
      commits.push(c(`c${i}`, ...parents))
    }
    const { rows } = layoutRows(commits, initialLaneState('c0'))
    expectContinuous(rows)
    for (const row of rows) expect(row.width).toBeGreaterThan(row.col)
  })
})
