// Lane layout for the commit graph (PRD F6 / F17 Git · 图谱). Pure and incremental: feed it `git log --topo-order`
// pages one after another with the state the previous page returned. O(commits · lanes).
//
// A lane is a column that "expects" a commit: the line drawn in it runs down until that commit's row. Lanes never
// shift sideways, so every line is vertical except where it meets a node: a line arriving from another column
// turns into the node at mid-row (a branch forking off), and a line leaving for another column turns down from
// mid-row (a merge). Column 0 can be reserved for the trunk (the default branch's first-parent chain) before its
// tip shows up, so `main` stays the left-most line however many branches are newer.

export interface GraphCommitInput {
  hash: string
  /** First parent first, as git prints them. Parents outside the log (shallow clones) are simply never reached. */
  parents: readonly string[]
}

export interface GraphRow {
  /** Column of this commit's node. */
  col: number
  /** Columns whose line passes straight through the row without touching the node. */
  through: number[]
  /** Columns whose line from above ends at this node (includes `col` when the line comes straight down). */
  incoming: number[]
  /** Columns the node's lines leave toward, one per parent in order (`col` for a straight first-parent line). */
  outgoing: number[]
  /** Columns this row draws in (highest used column + 1). */
  width: number
}

export interface LaneState {
  /** Per column: the hash the line in it runs toward, or null when the column is free. */
  lanes: (string | null)[]
  /** Column 0 is held for the trunk tip but nothing is drawn in it until the tip's row. */
  reserved: boolean
}

/** Starting state; `trunk` (the default branch tip) gets column 0. */
export function initialLaneState(trunk?: string | null): LaneState {
  return trunk ? { lanes: [trunk], reserved: true } : { lanes: [], reserved: false }
}

function freeColumn(lanes: (string | null)[]): number {
  const index = lanes.indexOf(null)
  return index < 0 ? lanes.length : index
}

/** Lays out the next commits; returns their rows and the state to continue with. Does not mutate `state`. */
export function layoutRows(commits: readonly GraphCommitInput[], state: LaneState): { rows: GraphRow[]; state: LaneState } {
  const lanes = state.lanes.slice()
  let reserved = state.reserved
  const rows: GraphRow[] = []

  for (const commit of commits) {
    const incoming: number[] = []
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === commit.hash) incoming.push(i)

    let col: number
    if (incoming.length > 0) {
      col = incoming[0]!
    } else {
      // A branch tip nothing above points at.
      col = freeColumn(lanes)
      lanes[col] = commit.hash
    }
    // The trunk tip's line starts here: there is nothing above it to come in.
    if (reserved && col === 0) {
      reserved = false
      incoming.shift()
    }

    const through: number[] = []
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null && lanes[i] !== commit.hash && !(reserved && i === 0)) through.push(i)
    }
    for (const i of incoming) lanes[i] = null
    lanes[col] = null

    const outgoing: number[] = []
    commit.parents.forEach((parent, index) => {
      if (index === 0) {
        // The first parent keeps the node's column, even when another lane already waits for it: both lines run
        // down and the other one turns into the parent's node there (the usual fork shape).
        lanes[col] = parent
        outgoing.push(col)
        return
      }
      const existing = lanes.indexOf(parent)
      if (existing >= 0) {
        // Merging the trunk tip in from above it: the trunk's line now starts here.
        if (existing === 0) reserved = false
        outgoing.push(existing)
        return
      }
      const free = freeColumn(lanes)
      lanes[free] = parent
      outgoing.push(free)
    })

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
    const width = Math.max(col, ...through, ...incoming, ...outgoing) + 1
    rows.push({ col, through, incoming, outgoing, width })
  }

  return { rows, state: { lanes, reserved } }
}
