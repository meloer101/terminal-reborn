// 同任务多解's report (PRD F4 v1.68, Figma 26I / 26J): once every member has stopped — its turn ended, it failed, its
// agent went away, or its task never went out — the session the task came from gets one message with each member's
// branch, changes, checks and result, asking it to compare them; it carries on after the user merges one. It goes
// through that agent's own channel (Claude's inbox, `codex queue`, PRD F21 §6.14), never typed into its terminal;
// without one, it waits under that terminal for the user's 送进去. One settle is reported once; a group whose member
// was merged reports no more. The user asked for this by pressing 开 N 份并发送, whose dialog names the session (§2).
import { create } from 'zustand'
import {
  attemptReportText,
  diffSummary,
  diffSummaryText,
  eventOf,
  memberLabels,
  reportDue,
  settledKey,
  type AttemptGroup,
  type MemberReport,
  type MemberState
} from '@shared/attempt-groups'
import type { Session, SessionId } from '@shared/types'
import { checksOf } from '../dispatch/handler'
import { deliverTo } from '../dispatch/reports'
import { useDispatch } from '../dispatch/store'
import { submitPrompt } from '../session-io'
import { markGroupReported, useAttemptGroups } from '../state/attempt-groups'
import { useWorkspace } from '../state/workspace'

/** Members' last messages and the status change come in separately; a settle waits this long before it counts. */
const SETTLE_MS = 3_000

export interface HeldAttemptReport {
  groupId: string
  text: string
  /** `Claude Code +38 −12 · Codex +51 −20` */
  summary: string
  count: number
}

/** Reports that could not go through a channel, per session reported to. Not saved. */
export const useAttemptReports = create<{ held: Record<SessionId, HeldAttemptReport | undefined> }>()(() => ({ held: {} }))

interface Member {
  session: Session
  path: string
  branch: string
}

function membersOf(group: AttemptGroup): Member[] {
  const { sessions, worktrees } = useWorkspace.getState()
  return group.members.flatMap((id) => {
    const session = sessions.find((s) => s.id === id)
    const worktree = session && worktrees.find((w) => w.id === session.worktreeId)
    return session && worktree && !worktree.archived ? [{ session, path: worktree.path, branch: worktree.branch }] : []
  })
}

function stateOf(m: Member): MemberState {
  const launch = useAttemptGroups.getState().launches[m.session.id]
  return {
    id: m.session.id,
    status: m.session.status,
    exited: m.session.phase === 'exited' || m.session.status === 'exited',
    ...(m.session.finishedAt !== undefined ? { finishedAt: m.session.finishedAt } : {}),
    launchFailed: launch?.phase === 'failed'
  }
}

async function changesOf(path: string, base: string): Promise<string | undefined> {
  try {
    const found = await window.tr.git.changes(path, base)
    return found ? diffSummaryText(diffSummary(found)) : undefined
  } catch {
    return undefined
  }
}

async function report(group: AttemptGroup, members: readonly Member[]): Promise<void> {
  const parent = useWorkspace.getState().sessions.find((s) => s.id === group.reportTo)
  if (!parent) return
  const labels = memberLabels(members.map((m) => (m.session.kind === 'shell' ? 'claude' : m.session.kind)))
  const reports = await Promise.all(
    members.map(async (m, i): Promise<MemberReport> => {
      const launch = useAttemptGroups.getState().launches[m.session.id]
      const changes = await changesOf(m.path, group.base)
      const checks = checksOf(m.session.id)
      const message = useDispatch.getState().messages[m.session.id] ?? m.session.lastReply
      return {
        label: labels[i] ?? '',
        branch: m.branch,
        event: eventOf(group, stateOf(m)),
        ...(changes ? { changes } : {}),
        ...(checks ? { checks } : {}),
        ...(launch?.phase === 'failed' ? { failure: launch.message } : message ? { message } : {})
      }
    })
  )
  const text = attemptReportText({ base: group.base, members: reports })
  const exited = parent.phase === 'exited' || parent.status === 'exited'
  const result = exited ? 'failed' : await deliverTo(parent, text)
  if (result === 'delivered') return
  const summary = reports.map((r) => [r.label, r.changes?.split(' · ')[0]].filter(Boolean).join(' ')).join(' · ')
  useAttemptReports.setState((s) => ({ held: { ...s.held, [parent.id]: { groupId: group.id, text, summary, count: reports.length } } }))
}

/** Checks every group; returns whether one settled too recently to count yet (check again shortly). */
function check(): boolean {
  let again = false
  for (const group of useAttemptGroups.getState().groups) {
    if (!group.reportTo) continue
    const members = membersOf(group)
    const key = settledKey(group, members.map(stateOf))
    if (!reportDue(group, key)) continue
    const newest = Math.max(0, ...members.map((m) => m.session.finishedAt ?? 0))
    if (Date.now() - newest < SETTLE_MS) {
      again = true
      continue
    }
    // Marked first, so a change while the report is being put together does not send it twice.
    markGroupReported(group.id, key)
    void report(group, members)
  }
  return again
}

/**
 * 送进去 under the session's terminal: the held report, typed into it like any message the user sends there (a
 * dialog on its screen refuses that, PRD §6.9). Resolves to an error to show, or null.
 */
export async function sendHeldAttemptReport(parentId: SessionId): Promise<string | null> {
  const held = useAttemptReports.getState().held[parentId]
  if (!held) return null
  try {
    await submitPrompt(parentId, held.text)
    useAttemptReports.setState((s) => ({ held: { ...s.held, [parentId]: undefined } }))
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Once per window that runs dispatch (the main one). */
export function startAttemptReports(): () => void {
  let timer: number | undefined
  // At most one check pending: other sessions' activity must not keep pushing it back.
  const schedule = (): void => {
    if (timer !== undefined) return
    timer = window.setTimeout(() => {
      timer = undefined
      if (check()) schedule()
    }, SETTLE_MS)
  }
  const offWorkspace = useWorkspace.subscribe((state, prev) => {
    if (state.sessions !== prev.sessions || state.worktrees !== prev.worktrees) schedule()
  })
  const offGroups = useAttemptGroups.subscribe((state, prev) => {
    if (state.launches !== prev.launches) schedule()
  })
  schedule()
  return () => {
    window.clearTimeout(timer)
    offWorkspace()
    offGroups()
  }
}
