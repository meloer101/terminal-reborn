// Lane layout for the commit graph (PRD F6 / F17 Git · 图谱). Pure and incremental: feed it `git log --topo-order`
// pages one after another with the state the previous page returned. O(commits · lanes).
//
// A lane is a column that "expects" a commit: the line drawn in it runs down until that commit's row. A line
// arriving from another column turns into the node at mid-row (a branch forking off); a line leaving for another
// column turns down from mid-row (a merge). Lanes are compacted at the bottom of every row, so when a branch ends the
// lanes to its right slide one column left within that row and the graph stays as narrow as the history allows.
// Each lane keeps the colour it was created with while it moves. Column 0 can be reserved for the trunk (the default
// branch's first-parent chain) before its tip shows up, so `main` stays the left-most line however many branches are
// newer; the trunk's colour is 0 and new lanes cycle through 1…LANE_COLORS.

export interface GraphCommitInput {
  hash: string
  /** First parent first, as git prints them. Parents outside the log (shallow clones) are simply never reached. */
  parents: readonly string[]
}

/** Colours other than the trunk's (lane/1…5). */
export const LANE_COLORS = 5

export interface LaneLine {
  /** Column at the row's top (through, incoming) or bottom (outgoing). */
  col: number
  /** 0 = trunk, 1…LANE_COLORS. */
  color: number
}

export interface ThroughLine {
  /** Column at the top of the row and at the bottom (different when the lane slides left). */
  from: number
  to: number
  color: number
}

export interface GraphRow {
  /** Column of this commit's node (in the row's top coordinates). */
  col: number
  color: number
  /** Lines that pass the row without touching the node. */
  through: ThroughLine[]
  /** Lines from above that end at this node (includes `col` when the line comes straight down). */
  incoming: LaneLine[]
  /** Lines the node sends down, one per parent in order, by their column at the row's bottom. */
  outgoing: LaneLine[]
  /** Columns this row draws in (highest column used + 1). */
  width: number
}

interface Lane {
  hash: string
  color: number
}

export interface LaneState {
  /** Per column: the commit the line in it runs toward. Compacted: only a row being laid out has gaps. */
  lanes: (Lane | null)[]
  /** Column 0 is held for the trunk tip but nothing is drawn in it until the tip's row. */
  reserved: boolean
  /** Colour the next new lane gets (1…LANE_COLORS). */
  nextColor: number
}

/** Starting state; `trunk` (the default branch tip) gets column 0. */
export function initialLaneState(trunk?: string | null): LaneState {
  return trunk ? { lanes: [{ hash: trunk, color: 0 }], reserved: true, nextColor: 1 } : { lanes: [], reserved: false, nextColor: 1 }
}

/** Lays out the next commits; returns their rows and the state to continue with. Does not mutate `state`. */
export function layoutRows(commits: readonly GraphCommitInput[], state: LaneState): { rows: GraphRow[]; state: LaneState } {
  let lanes = state.lanes.slice()
  let reserved = state.reserved
  let nextColor = state.nextColor
  const newColor = () => {
    const color = nextColor
    nextColor = (nextColor % LANE_COLORS) + 1
    return color
  }
  const rows: GraphRow[] = []

  for (const commit of commits) {
    const incoming: LaneLine[] = []
    lanes.forEach((lane, i) => {
      if (lane?.hash === commit.hash) incoming.push({ col: i, color: lane.color })
    })

    let col: number
    let color: number
    if (incoming.length > 0) {
      col = incoming[0]!.col
      color = incoming[0]!.color
    } else {
      // A branch tip nothing above points at: a new lane on the right.
      col = lanes.length
      color = newColor()
      lanes.push({ hash: commit.hash, color })
    }
    // The trunk tip's line starts here: there is nothing above it to come in.
    if (reserved && col === 0) {
      reserved = false
      incoming.shift()
    }

    const throughFrom: number[] = []
    lanes.forEach((lane, i) => {
      if (lane !== null && lane.hash !== commit.hash && !(reserved && i === 0)) throughFrom.push(i)
    })
    for (const line of incoming) lanes[line.col] = null
    lanes[col] = null

    // Parents, by their column before compaction.
    const parentCols: number[] = []
    commit.parents.forEach((parent, index) => {
      if (index === 0) {
        // The first parent keeps the node's lane and colour, even when another lane already waits for it: both run
        // down and the other one turns into the parent's node there (the usual fork shape).
        lanes[col] = { hash: parent, color }
        parentCols.push(col)
        return
      }
      const existing = lanes.findIndex((lane) => lane?.hash === parent)
      if (existing >= 0) {
        // Merging the trunk tip in from above it: the trunk's line now starts here.
        if (existing === 0) reserved = false
        parentCols.push(existing)
        return
      }
      const free = lanes.indexOf(null)
      const at = free < 0 ? lanes.length : free
      lanes[at] = { hash: parent, color: newColor() }
      parentCols.push(at)
    })

    // Compact: every surviving lane moves to its rank among the survivors.
    const bottom: number[] = []
    let next = 0
    for (let i = 0; i < lanes.length; i++) if (lanes[i] !== null) bottom[i] = next++
    const through = throughFrom.map((from) => ({ from, to: bottom[from]!, color: lanes[from]!.color }))
    const outgoing = parentCols.map((at) => ({ col: bottom[at]!, color: lanes[at]!.color }))
    lanes = lanes.filter((lane) => lane !== null)

    const width =
      Math.max(col, ...through.map((t) => Math.max(t.from, t.to)), ...incoming.map((l) => l.col), ...outgoing.map((l) => l.col)) + 1
    rows.push({ col, color, through, incoming, outgoing, width })
  }

  return { rows, state: { lanes, reserved, nextColor } }
}
