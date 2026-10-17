// Pure parts of the Git · 图谱 view (PRD F17 13B / 13H): row geometry, lane colours, ref pills, relative time.
import type { GitRef, GitWorktreeEntry } from '@shared/git-graph/log'
import type { GraphRow } from '@shared/git-graph/lanes'
import type { SessionId, SessionStatus } from '@shared/types'

/** Figma 13B: rows 28 high, lanes 17 apart starting 18 in, text 15 past the last lane. */
export const ROW_HEIGHT = 28
export const LANE_X0 = 18
export const LANE_GAP = 17
export const TEXT_GAP = 15
/** Lines 2 wide, turns of radius 8, nodes 8 (HEAD 10) with a 2px gap cut around them. */
export const LINE_WIDTH = 2
export const TURN_RADIUS = 8
export const NODE_RADIUS = 4
export const HEAD_NODE_RADIUS = 5
export const NODE_GAP = 2
/** Columns drawn at most; anything further right is clipped. */
export const MAX_COLUMNS = 16

const MID = ROW_HEIGHT / 2

export const laneX = (col: number): number => LANE_X0 + col * LANE_GAP

/** Lane colour 0 is the trunk (neutral); 1…5 are lane/1…5. */
export function laneColor(color: number): string {
  return color === 0 ? 'var(--lane-main)' : `var(--lane-${((color - 1) % 5) + 1})`
}

/** Where commit text starts for a graph `columns` wide. */
export const textLeft = (columns: number): number => laneX(Math.max(1, Math.min(columns, MAX_COLUMNS)) - 1) + TEXT_GAP

export interface LinePath {
  d: string
  /** Lane colour (0 = trunk). */
  color: number
}

/** SVG paths for one row, in row coordinates (0…ROW_HEIGHT). */
export function rowPaths(row: GraphRow): LinePath[] {
  const paths: LinePath[] = []
  const xc = laneX(row.col)
  const r = TURN_RADIUS
  for (const { from, to, color } of row.through) {
    const x0 = laneX(from)
    const x1 = laneX(to)
    // A lane sliding left (a branch to its left ended in this row) eases across the row.
    paths.push({ d: x0 === x1 ? `M${x0} 0V${ROW_HEIGHT}` : `M${x0} 0C${x0} ${MID} ${x1} ${MID} ${x1} ${ROW_HEIGHT}`, color })
  }
  for (const { col, color } of row.incoming) {
    if (col === row.col) {
      paths.push({ d: `M${xc} 0V${MID}`, color })
      continue
    }
    // Down the branch's column, then a turn into the node.
    const x = laneX(col)
    const dir = Math.sign(xc - x)
    paths.push({ d: `M${x} 0V${MID - r}A${r} ${r} 0 0 ${dir > 0 ? 0 : 1} ${x + dir * r} ${MID}H${xc}`, color })
  }
  for (const { col, color } of row.outgoing) {
    if (col === row.col) {
      paths.push({ d: `M${xc} ${MID}V${ROW_HEIGHT}`, color })
      continue
    }
    // Out of the node sideways, then a turn down the parent's column.
    const x = laneX(col)
    const dir = Math.sign(x - xc)
    paths.push({ d: `M${xc} ${MID}H${x - dir * r}A${r} ${r} 0 0 ${dir > 0 ? 1 : 0} ${x} ${MID + r}V${ROW_HEIGHT}`, color })
  }
  return paths
}

// --- ref pills (Figma GraphRef 153:210) ----------------------------------------------------------------------------

export type PillKind = 'worktree' | 'local' | 'remote' | 'tag'

export interface GraphPill {
  kind: PillKind
  name: string
  /** Worktree pills: the session to switch to and the glyph to show. */
  sessionId?: SessionId
  status?: SessionStatus
}

/** The most urgent session of each workspace worktree, keyed by its real path. */
export type SessionsByPath = ReadonlyMap<string, { sessionId: SessionId; status: SessionStatus }>

const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? path

/**
 * Pills per commit hash, in Figma order: worktrees with a session, local branches, remote branches, tags.
 * A branch checked out in a worktree that has a session shows once, as that worktree's pill.
 */
export function buildPills(refs: readonly GitRef[], worktrees: readonly GitWorktreeEntry[], sessions: SessionsByPath): Map<string, GraphPill[]> {
  const pills = new Map<string, GraphPill[]>()
  const add = (hash: string, pill: GraphPill) => {
    const list = pills.get(hash)
    if (list) list.push(pill)
    else pills.set(hash, [pill])
  }
  const shownAsWorktree = new Set<string>()
  for (const worktree of worktrees) {
    const session = sessions.get(worktree.path)
    if (!worktree.head || !session) continue
    if (worktree.branch) shownAsWorktree.add(worktree.branch)
    add(worktree.head, { kind: 'worktree', name: worktree.branch ?? baseName(worktree.path), ...session })
  }
  const order: Record<GitRef['kind'], number> = { local: 0, remote: 1, tag: 2 }
  const sorted = [...refs].sort((a, b) => order[a.kind] - order[b.kind])
  for (const ref of sorted) {
    if (ref.kind === 'local' && shownAsWorktree.has(ref.name)) continue
    add(ref.hash, { kind: ref.kind, name: ref.name })
  }
  return pills
}

// --- time ---------------------------------------------------------------------------------------------------------

/** Compact age of a commit: `<1m`, `4m`, `3h`, `2d`, `5w`, `8mo`, `2y`. */
export function commitAge(nowMs: number, timeSec: number): string {
  const minutes = Math.floor(Math.max(0, nowMs - timeSec * 1000) / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days}d`
  if (days < 60) return `${Math.floor(days / 7)}w`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}
