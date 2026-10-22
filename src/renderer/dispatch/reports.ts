// Reports from dispatched sessions to the agent that started them (PRD F21). A child's turn ending, failing or its
// agent exiting queues a report (one per child, newest wins); 3 s after the last one, the batch goes to the dispatcher
// through its agent's own channel (Claude's inbox, `codex queue`), never typed into its terminal. Without a channel,
// when delivery fails or past the hourly budget, the batch waits on the dispatcher's row for the user's 送进去.
import { diffSummary, diffSummaryText } from '@shared/attempt-groups'
import { childEvent, enqueueReport, isDispatchAgent, reportText, takeDue, type ChildEvent, type ChildReport, type DeliverResult } from '@shared/dispatch'
import type { Session, SessionId } from '@shared/types'
import { submitPrompt } from '../session-io'
import { useWorkspace } from '../state/workspace'
import { checksOf, conflictsOf, childrenOf } from './handler'
import { addHeld, queueOf, setMessage, setQueue, takeHeld, useDispatch } from './store'

const timers = new Map<SessionId, number>()

const view = (s: Session) => ({ status: s.status, exited: s.phase === 'exited' || s.status === 'exited' })

/** Into an agent's session through its own channel; `no-channel` / `failed` mean nothing was sent. */
export async function deliverTo(session: Session, text: string): Promise<DeliverResult> {
  if (!isDispatchAgent(session.kind)) return 'no-channel'
  return window.tr.dispatch
    .deliver({ sessionId: session.id, agent: session.kind, ...(session.agentSessionId ? { agentSessionId: session.agentSessionId } : {}), text })
    .catch((): DeliverResult => 'failed')
}

function queue(child: Session, event: ChildEvent): void {
  const parentId = child.dispatchedBy
  if (!parentId || !isDispatchAgent(child.kind)) return
  const worktree = useWorkspace.getState().worktrees.find((w) => w.id === child.worktreeId)
  const report: ChildReport = {
    childId: child.id,
    title: child.title,
    agent: child.kind,
    event,
    branch: worktree?.branch ?? '',
    ...(child.finishedAt !== undefined ? { turn: child.finishedAt } : {})
  }
  setQueue(parentId, enqueueReport(queueOf(parentId), report, Date.now()))
  schedule(parentId)
}

function schedule(parentId: SessionId): void {
  window.clearTimeout(timers.get(parentId))
  timers.delete(parentId)
  const due = takeDue(queueOf(parentId), Date.now())
  if (due.kind === 'wait') {
    timers.set(parentId, window.setTimeout(() => schedule(parentId), due.ms))
  } else if (due.kind === 'send') {
    setQueue(parentId, due.queue)
    void flush(parentId, due.batch)
  } else if (due.kind === 'held') {
    addHeld(parentId, due.queue.pending)
    setQueue(parentId, { ...due.queue, pending: [], lastAt: null })
  }
}

/** The facts as they are now (the child's message, diff, checks, conflicts), read when the batch goes out. */
async function complete(report: ChildReport): Promise<ChildReport> {
  const children = childrenOf(useWorkspace.getState().sessions.find((s) => s.id === report.childId)?.dispatchedBy ?? '')
  const place = children.find((c) => c.session.id === report.childId)
  if (!place) return report
  const message = report.event === 'error' ? (place.session.currentAction ?? place.session.lastReply) : (useDispatch.getState().messages[report.childId] ?? place.session.lastReply)
  let changes: string | undefined
  try {
    const found = await window.tr.git.changes(place.worktree.path, place.worktree.baseBranch)
    if (found) changes = diffSummaryText(diffSummary(found))
  } catch {
    changes = undefined
  }
  const checks = checksOf(report.childId)
  const conflicts = conflictsOf(place)
  return { ...report, title: place.session.title, ...(message ? { message } : {}), ...(changes ? { changes } : {}), ...(checks ? { checks } : {}), ...(conflicts ? { conflicts } : {}) }
}

function stillRunning(parentId: SessionId, batch: readonly ChildReport[]): { title: string }[] {
  return childrenOf(parentId)
    .filter((c) => !c.worktree.archived && !batch.some((r) => r.childId === c.session.id) && (c.session.status === 'running' || c.session.phase === 'starting'))
    .map((c) => ({ title: c.session.title }))
}

async function flush(parentId: SessionId, batch: readonly ChildReport[]): Promise<void> {
  const parent = useWorkspace.getState().sessions.find((s) => s.id === parentId)
  // Nobody left to tell (closed: its children were made ordinary sessions already).
  if (!parent) return
  const full = await Promise.all(batch.map(complete))
  if (parent.phase === 'exited' || parent.status === 'exited') return addHeld(parentId, full)
  const result = await deliverTo(parent, reportText(full, stillRunning(parentId, full)))
  if (result !== 'delivered') addHeld(parentId, full)
}

/**
 * 送进去 on the dispatcher's row: the held reports, typed into its terminal like any message the user sends there
 * (the user pressed the button; a dialog on screen refuses it, PRD §6.9). Resolves to an error to show, or null.
 */
export async function sendHeld(parentId: SessionId): Promise<string | null> {
  const batch = takeHeld(parentId)
  if (batch.length === 0) return null
  const full = await Promise.all(batch.map(complete))
  try {
    await submitPrompt(parentId, reportText(full, stillRunning(parentId, full)))
    return null
  } catch (error) {
    addHeld(parentId, batch)
    return error instanceof Error ? error.message : String(error)
  }
}

/** Once per window: watches the children and keeps their last messages. */
export function startReports(): () => void {
  const offWorkspace = useWorkspace.subscribe((state, prev) => {
    if (state.sessions === prev.sessions) return
    const before = new Map(prev.sessions.map((s) => [s.id, s]))
    for (const child of state.sessions) {
      if (!child.dispatchedBy) continue
      const old = before.get(child.id)
      const event = old ? childEvent(view(old), view(child)) : null
      if (event) queue(child, event)
    }
  })
  const offEvents = window.tr.agent.onEvent(({ sessionId, event }) => {
    if (event.type !== 'stop' || !event.message) return
    if (useWorkspace.getState().sessions.some((s) => s.id === sessionId && s.dispatchedBy)) setMessage(sessionId, event.message)
  })
  return () => {
    offWorkspace()
    offEvents()
    for (const timer of timers.values()) window.clearTimeout(timer)
    timers.clear()
  }
}
