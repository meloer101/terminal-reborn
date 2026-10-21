// Conflict radar in the window: which worktrees main should check, and the reports it sends back. git runs in
// main (src/main/conflict-radar.ts); this mirrors it. Nothing shows while git is too old.
import { create } from 'zustand'
import { radarMark, type RadarMark, type RadarReport } from '@shared/conflict-radar'
import type { Project, Session, Worktree } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { radarTargets } from './model'

export const useRadar = create<{ byRoot: Record<string, RadarReport> }>()(() => ({ byRoot: {} }))

export function acceptRadarReport(report: RadarReport): void {
  useRadar.setState((s) => ({ byRoot: { ...s.byRoot, [report.root]: report } }))
}

let started = false

/** Keeps main's watch list in step with the workspace and mirrors its reports. Once per window. */
export function startConflictRadarBridge(): void {
  if (started) return
  started = true
  window.tr.radar.onReport(acceptRadarReport)
  let sent = ''
  const sync = (): void => {
    const targets = radarTargets(useWorkspace.getState())
    const key = JSON.stringify(targets)
    if (key === sent) return
    sent = key
    window.tr.radar.watch(targets)
  }
  sync()
  useWorkspace.subscribe(sync)
  void window.tr.radar.reports().then((list) => list.forEach(acceptRadarReport))
}

/** The other worktrees are named by their branch. */
export function markFor(report: RadarReport | undefined, worktreePath: string): RadarMark | null {
  if (!report) return null
  return radarMark(report, worktreePath, (path) => report.worktrees.find((w) => w.worktree === path)?.branch ?? path.split('/').pop() ?? path)
}

/** The radar's mark for a workspace worktree (by its path and project root). */
export function useRadarMark(root: string | null | undefined, worktreePath: string | null | undefined): RadarMark | null {
  const report = useRadar((s) => (root ? s.byRoot[root] : undefined))
  return worktreePath ? markFor(report, worktreePath) : null
}

export function useSessionRadarMark(sessionId: string): RadarMark | null {
  const where = useWorkspace((s) => {
    const session = s.sessions.find((x) => x.id === sessionId)
    const worktree = s.worktrees.find((w) => w.id === session?.worktreeId)
    const root = s.projects.find((p) => p.id === worktree?.projectId)?.rootPath
    return worktree && root ? `${root}\0${worktree.path}` : null
  })
  const [root, path] = where ? where.split('\0') : [null, null]
  return useRadarMark(root, path)
}

/** Whether any of these sessions' worktrees has a mark (the overview's column appears then). */
export function anyRadarMark(
  byRoot: Record<string, RadarReport>,
  state: { projects: readonly Project[]; worktrees: readonly Worktree[] },
  sessions: readonly Pick<Session, 'worktreeId'>[]
): boolean {
  const worktrees = new Map(state.worktrees.map((w) => [w.id, w]))
  const roots = new Map(state.projects.map((p) => [p.id, p.rootPath]))
  return sessions.some((s) => {
    const worktree = worktrees.get(s.worktreeId)
    return worktree ? markFor(byRoot[roots.get(worktree.projectId) ?? ''], worktree.path) !== null : false
  })
}

/** The mark of a Worktree view row, through the workspace records of its folder. */
export function useWorktreeRadarMark(root: string, worktreeIds: readonly string[]): RadarMark | null {
  const path = useWorkspace((s) => s.worktrees.find((w) => worktreeIds.includes(w.id) && !w.archived)?.path ?? null)
  return useRadarMark(root, path)
}
