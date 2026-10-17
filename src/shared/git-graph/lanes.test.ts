import { describe, expect, it } from 'vitest'
import { initialLaneState, layoutRows, type GraphCommitInput, type GraphRow } from './lanes'

/** `c('b', 'a')` = commit b with parent a. */
const c = (hash: string, ...parents: string[]): GraphCommitInput => ({ hash, parents })

const cols = (rows: GraphRow[]) => rows.map((r) => r.col)
const inCols = (row: GraphRow) => row.incoming.map((l) => l.col)
const outCols = (row: GraphRow) => row.outgoing.map((l) => l.col)
const moves = (row: GraphRow) => row.through.map((t) => [t.from, t.to])

/**
 * Lines leaving the bottom of each row must be exactly the lines entering the top of the next one, with the same
 * colour, and no column may hold two lines at once.
 */
function expectContinuous(rows: GraphRow[]): void {
  for (let i = 0; i + 1 < rows.length; i++) {
    const bottom = new Map<number, number>()
    for (const t of rows[i]!.through) bottom.set(t.to, t.color)
    for (const o of rows[i]!.outgoing) {
      const seen = bottom.get(o.col)
      if (seen !== undefined) expect(seen, `row ${i} merges into a lane of another colour`).toBe(o.color)
      bottom.set(o.col, o.color)
    }
    const top = new Map<number, number>()
    for (const t of rows[i + 1]!.through) top.set(t.from, t.color)
    for (const l of rows[i + 1]!.incoming) top.set(l.col, l.color)
    expect([...top].sort(), `row ${i} → ${i + 1}`).toEqual([...bottom].sort())
    // Compacted: the columns in use at a row boundary are 0…n-1 (column 0 may be the reserved trunk).
    const used = [...bottom.keys()].sort((a, b) => a - b)
    expect(used.every((col, k) => col === k || col === k + 1), `row ${i} leaves a gap: ${used}`).toBe(true)
  }
}

describe('layoutRows', () => {
  it('draws a linear history in one column', () => {
    const { rows } = layoutRows([c('c', 'b'), c('b', 'a'), c('a')], initialLaneState())
    expect(rows).toEqual([
      { col: 0, color: 1, through: [], incoming: [], outgoing: [{ col: 0, color: 1 }], width: 1 },
      { col: 0, color: 1, through: [], incoming: [{ col: 0, color: 1 }], outgoing: [{ col: 0, color: 1 }], width: 1 },
      { col: 0, color: 1, through: [], incoming: [{ col: 0, color: 1 }], outgoing: [], width: 1 }
    ])
  })

  it('forks: a branch line turns into its parent node at the parent row', () => {
    const { rows } = layoutRows([c('f1', 'base'), c('m2', 'base'), c('base')], initialLaneState())
    expect(cols(rows)).toEqual([0, 1, 0])
    expect(rows[1]).toMatchObject({ incoming: [], outgoing: [{ col: 1 }] })
    expect(moves(rows[1]!)).toEqual([[0, 0]])
    expect(inCols(rows[2]!)).toEqual([0, 1])
    expectContinuous(rows)
  })

  it('keeps the trunk in column 0 and in the trunk colour even when a branch is newer', () => {
    const { rows } = layoutRows([c('f1', 'base'), c('m2', 'base'), c('base')], initialLaneState('m2'))
    expect(cols(rows)).toEqual([1, 0, 0])
    expect(rows.map((r) => r.color)).toEqual([1, 0, 0])
    // Nothing is drawn in the reserved column above the trunk tip.
    expect(rows[0]).toMatchObject({ through: [], incoming: [], outgoing: [{ col: 1, color: 1 }], width: 2 })
    expect(rows[1]).toMatchObject({ incoming: [], outgoing: [{ col: 0, color: 0 }] })
    expect(inCols(rows[2]!)).toEqual([0, 1])
    expectContinuous(rows)
  })

  it('merges: the second parent leaves sideways in a new colour and runs down its own column', () => {
    const commits = [c('M', 'm1', 'f2'), c('f2', 'f1'), c('m1', 'base'), c('f1', 'base'), c('base')]
    const { rows } = layoutRows(commits, initialLaneState('M'))
    expect(cols(rows)).toEqual([0, 1, 0, 1, 0])
    expect(rows[0]!.outgoing).toEqual([
      { col: 0, color: 0 },
      { col: 1, color: 1 }
    ])
    expect(rows[1]).toMatchObject({ color: 1, incoming: [{ col: 1, color: 1 }] })
    expect(inCols(rows[4]!)).toEqual([0, 1])
    expectContinuous(rows)
  })

  it('reuses an existing lane when the merged parent is already expected', () => {
    const commits = [c('t', 'p'), c('M', 'm', 'p'), c('p', 'root'), c('m', 'root'), c('root')]
    const { rows } = layoutRows(commits, initialLaneState())
    expect(cols(rows)).toEqual([0, 1, 0, 1, 0])
    expect(outCols(rows[1]!)).toEqual([1, 0])
    expect(rows[1]!.outgoing[1]!.color).toBe(rows[0]!.color)
    expectContinuous(rows)
  })

  it('lays out an octopus merge with one new column per extra parent', () => {
    const commits = [c('O', 'a', 'b', 'c'), c('c', 'r'), c('b', 'r'), c('a', 'r'), c('r')]
    const { rows } = layoutRows(commits, initialLaneState())
    expect(rows[0]).toMatchObject({ col: 0, width: 3 })
    expect(outCols(rows[0]!)).toEqual([0, 1, 2])
    expect(new Set(rows[0]!.outgoing.map((o) => o.color)).size).toBe(3)
    expect(cols(rows)).toEqual([0, 2, 1, 0, 0])
    expect(inCols(rows[4]!)).toEqual([0, 1, 2])
    expectContinuous(rows)
  })

  it('compacts: when a branch ends, the lanes to its right slide left in that row and keep their colour', () => {
    // a (col 1) joins main at r; b (col 2) keeps going and moves to column 1 in r's row.
    const commits = [c('b', 'b0'), c('a', 'r'), c('m', 'r'), c('r', 'x'), c('b0', 'x'), c('x')]
    const { rows, state } = layoutRows(commits, initialLaneState('m'))
    expect(cols(rows)).toEqual([1, 2, 0, 0, 1, 0])
    const r = rows[3]!
    expect(inCols(r)).toEqual([0, 2])
    expect(r.through).toEqual([{ from: 1, to: 1, color: 1 }])
    // b's lane was column 1 all along here (a was to its right), so check the slide in a case where it is not:
    const slide = layoutRows([c('a', 'r'), c('b', 'b0'), c('m', 'r'), c('r', 'x'), c('b0', 'x'), c('x')], initialLaneState('m'))
    const row = slide.rows[3]!
    expect(inCols(row)).toEqual([0, 1])
    expect(row.through).toEqual([{ from: 2, to: 1, color: 2 }])
    expect(slide.rows[4]).toMatchObject({ col: 1, color: 2 })
    expectContinuous(slide.rows)
    expectContinuous(rows)
    expect(state.lanes).toEqual([])
  })

  it('handles many parallel branches without losing a line', () => {
    const tips = Array.from({ length: 12 }, (_, i) => c(`t${i}`, 'root'))
    const { rows } = layoutRows([...tips, c('root')], initialLaneState())
    expect(cols(rows)).toEqual([...Array.from({ length: 12 }, (_, i) => i), 0])
    expect(rows[11]!.width).toBe(12)
    expect(inCols(rows[12]!)).toEqual(Array.from({ length: 12 }, (_, i) => i))
    expectContinuous(rows)
  })

  it('stays narrow when old branches have ended', () => {
    // Ten short-lived branches one after another: the graph never needs more than two columns.
    const commits: GraphCommitInput[] = []
    for (let i = 0; i < 10; i++) commits.push(c(`f${i}`, `m${i}`), c(`m${i}`, `m${i + 1}`))
    commits.push(c('m10'))
    const { rows } = layoutRows(commits, initialLaneState('m0'))
    expect(Math.max(...rows.map((r) => r.width))).toBe(2)
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
    expect(outCols(rows[0]!)).toEqual([0, 1])
    expect(state.lanes.map((l) => l?.hash)).toEqual(['a', 'b'])
  })

  it('stays continuous on a random history', () => {
    // Deterministic pseudo-random DAG in topo order (children before parents).
    let seed = 7
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    const n = 400
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
