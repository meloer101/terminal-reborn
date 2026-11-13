// The right panel's 终端 view (PRD F17, Figma 76): plain shells in a worktree, one per tab, outside the workspace's
// sessions (no sidebar row, no status). Their PTY ids carry the worktree and a number, so after a window reload or a
// relaunch the shells still running in the pty daemon are found again by id.
import type { SessionId, WorktreeId } from './types'

const PREFIX = 'panel-'
/** `panel-<worktreeId>-<n>`; the worktree id may itself contain dashes, the number is the last part. */
const PANEL_ID = /^panel-(.+)-([1-9]\d*)$/

export interface PanelTerminalRef {
  worktreeId: WorktreeId
  n: number
}

/** The PTY id of the worktree's `n`th panel shell. */
export function panelTerminalId(worktreeId: WorktreeId, n: number): SessionId {
  return `${PREFIX}${worktreeId}-${n}`
}

/** The worktree and number of a panel shell's id; null for any other id (a workspace session's). */
export function parsePanelTerminalId(id: string): PanelTerminalRef | null {
  const match = PANEL_ID.exec(id)
  if (!match) return null
  const n = Number(match[2])
  return Number.isSafeInteger(n) ? { worktreeId: match[1]!, n } : null
}

export function isPanelTerminalId(id: string): boolean {
  return parsePanelTerminalId(id) !== null
}

/** The worktree's panel shells among `ids`, in the order they were opened (by number). */
export function panelTerminalsOf(ids: readonly string[], worktreeId: WorktreeId): SessionId[] {
  return ids
    .map((id) => ({ id, ref: parsePanelTerminalId(id) }))
    .filter((x): x is { id: string; ref: PanelTerminalRef } => x.ref?.worktreeId === worktreeId)
    .sort((a, b) => a.ref.n - b.ref.n)
    .map((x) => x.id)
}

/** The number for the worktree's next shell: one past the highest among `ids` (1 when it has none). */
export function nextPanelTerminalNumber(ids: readonly string[], worktreeId: WorktreeId): number {
  let max = 0
  for (const id of ids) {
    const ref = parsePanelTerminalId(id)
    if (ref?.worktreeId === worktreeId && ref.n > max) max = ref.n
  }
  return max + 1
}
