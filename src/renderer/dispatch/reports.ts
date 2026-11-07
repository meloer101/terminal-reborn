// Messages between dispatched sessions and the sessions that started them (PRD F21). A child's own `wavi report`, or —
// when it gives none — its turn ending, failing or its agent exiting, queues a report (one per child, newest wins, a
// child's own report never replaced by Wavi's); 3 s after the last one, the batch goes to the dispatcher. Delivery
// has three tiers by vendor: its own channel (Claude's inbox, `codex queue`, Pi's extension); typing it in with the
// §6.9 send protocol for the CLIs whose status is exact, only while nobody is typing there; else — and whenever the
// first two cannot — it waits under the session's terminal for the user's 送进去. Never resent when unsure (Solo).
import { diffSummary, diffSummaryText, groupOfSession } from '@shared/attempt-groups'
import { childEvent, enqueueReport, isDispatchAgent, maySendNow, reportChannelOf, reportText, takeDue, type ChildEvent, type ChildReport, type DeliverResult } from '@shared/dispatch'
import type { Session, SessionId } from '@shared/types'
import { submitPrompt } from '../session-io'
import { useAttemptGroups } from '../state/attempt-groups'
import { useWorkspace } from '../state/workspace'
import { typingIn } from '../terminal/typing'
import { checksOf, conflictsOf, childrenOf } from './places'
import { addHeld, heldReports, queueOf, setMessage, setQueue, setReported, takeHeld, useDispatch, type HeldItem } from './store'

const timers = new Map<SessionId, number>()

const view = (s: Session) => ({ status: s.status, exited: s.phase === 'exited' || s.status === 'exited', ...(s.finishedAt !== undefined ? { finishedAt: s.finishedAt } : {}) })

const gone = (s: Session): boolean => s.phase === 'exited' || s.status === 'exited'

/**
 * Into an agent's session without the user's hand: its own channel, or typed in when its vendor has none but exact
 * status and nobody is typing there. `no-channel` / `failed` mean nothing was sent (the caller holds it for 送进去).
 */
export async function deliverTo(session: Session, text: string): Promise<DeliverResult> {
  if (!isDispatchAgent(session.kind) || gone(session)) return 'no-channel'
  const channel = reportChannelOf(session.kind)
  if (channel === 'manual') return 'no-channel'
  if (channel === 'send') {
    if (session.phase !== 'ready') return 'no-channel'
    if (!maySendNow({ status: session.status, ...typingIn(session.id), now: Date.now() })) return 'no-channel'
    try {
      await submitPrompt(session.id, text)
      return 'delivered'
    } catch {
      return 'failed'
    }
  }
  return window.tr.dispatch
    .deliver({ sessionId: session.id, agent: session.kind, ...(session.agentSessionId ? { agentSessionId: session.agentSessionId } : {}), text })
    .catch((): DeliverResult => 'failed')
}

/** One message, delivered or held under that session's terminal for 送进去. */
export async function deliverMessage(session: Session, text: string, held: { key: string; title: string }): Promise<'delivered' | 'held'> {
  if ((await deliverTo(session, text)) === 'delivered') return 'delivered'
  addHeld(session.id, [{ kind: 'message', key: held.key, title: held.title, text }])
  return 'held'
}

/**
 * A child's finished turn needs no notification of its own when its report goes into the dispatcher (PRD F21 回报 ·
 * 不打扰人): the dispatcher is there and has a channel or the typed send. 同任务多解's members report differently.
 */
export function finishGoesToDispatcher(id: SessionId): boolean {
  const { sessions } = useWorkspace.getState()
  const child = sessions.find((s) => s.id === id)
  const parent = child?.dispatchedBy ? sessions.find((s) => s.id === child.dispatchedBy) : undefined
  if (!child || !parent || !isDispatchAgent(parent.kind) || gone(parent)) return false
  if (groupOfSession(useAttemptGroups.getState().groups, child.id)?.reportTo === parent.id) return false
  return reportChannelOf(parent.kind) !== 'manual'
}

/** Queues a report about `child` for its dispatcher: its own (`report`, with its text) or one of Wavi's. */
export function queueReport(child: Session, event: ChildEvent, own?: string): void {
  const parentId = child.dispatchedBy
  if (!parentId || !isDispatchAgent(child.kind)) return
  // 同任务多解's members report together once they have all stopped (attempts/report.ts).
  if (groupOfSession(useAttemptGroups.getState().groups, child.id)?.reportTo === parentId) return
  const queue = queueOf(parentId)
  // The child's own report says more than Wavi could: a settle right after it does not replace it.
  if (event !== 'report' && queue.pending.some((r) => r.childId === child.id && r.event === 'report')) return
  const worktree = useWorkspace.getState().worktrees.find((w) => w.id === child.worktreeId)
  // Which settle this is, so one is reported once: a finished turn by when it finished; an error or exit, which leaves
  // finishedAt as it was, by when that status began (two errors in a row are two reports).
  const turn = event === 'report' ? Date.now() : event === 'done' ? child.finishedAt : (child.statusSince ?? Date.now())
  const report: ChildReport = {
    childId: child.id,
    title: child.title,
    agent: child.kind,
    event,
    branch: child.dispatchBase === 'snapshot' ? '' : (worktree?.branch ?? ''),
    ...(child.dispatchModel ? { model: child.dispatchModel } : {}),
    ...(own ? { message: own } : {}),
    ...(turn !== undefined ? { turn } : {})
  }
  setQueue(parentId, enqueueReport(queue, report, Date.now()))
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
    addHeld(parentId, heldReports(due.queue.pending))
    setQueue(parentId, { ...due.queue, pending: [], lastAt: null })
  }
}

/** The facts as they are now (the child's message, diff, checks, conflicts), read when the batch goes out. */
async function complete(report: ChildReport): Promise<ChildReport> {
  const children = childrenOf(useWorkspace.getState().sessions.find((s) => s.id === report.childId)?.dispatchedBy ?? '')
  const place = children.find((c) => c.session.id === report.childId)
  if (!place) return report
  const message =
    report.event === 'report'
      ? report.message
      : report.event === 'error'
        ? (place.session.currentAction ?? place.session.lastReply)
        : (useDispatch.getState().messages[report.childId] ?? place.session.lastReply)
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
  const result = await deliverTo(parent, reportText(full, stillRunning(parentId, full)))
  if (result !== 'delivered') addHeld(parentId, heldReports(full))
}

/** What 送进去 types: the held reports as one report, then each held message. */
async function heldText(sessionId: SessionId, items: readonly HeldItem[]): Promise<string> {
  const reports = await Promise.all(items.flatMap((i) => (i.kind === 'report' ? [complete(i.report)] : [])))
  const messages = items.flatMap((i) => (i.kind === 'message' ? [i.text] : []))
  return [...(reports.length > 0 ? [reportText(reports, stillRunning(sessionId, reports))] : []), ...messages].join('\n\n')
}

/**
 * 送进去 under a session's terminal: what waits there, typed in like any message the user sends there (the user pressed
 * the button; a dialog on screen refuses it, PRD §6.9). Resolves to an error to show, or null.
 */
export async function sendHeld(sessionId: SessionId): Promise<string | null> {
  const items = takeHeld(sessionId)
  if (items.length === 0) return null
  try {
    await submitPrompt(sessionId, await heldText(sessionId, items))
    return null
  } catch (error) {
    addHeld(sessionId, items)
    return error instanceof Error ? error.message : String(error)
  }
}

/** Once per window: watches the children and keeps their last messages. */
/** Queues taken up from a saved workspace: what is due goes out, the rest waits for its time again. */
export function resumeReports(): void {
  for (const [parentId, queue] of Object.entries(useDispatch.getState().queues)) if (queue && queue.pending.length > 0) schedule(parentId)
}

export function startReports(): () => void {
  const offWorkspace = useWorkspace.subscribe((state, prev) => {
    if (state.sessions === prev.sessions) return
    const before = new Map(prev.sessions.map((s) => [s.id, s]))
    for (const child of state.sessions) {
      if (!child.dispatchedBy) continue
      const old = before.get(child.id)
      const event = old ? childEvent(view(old), view(child)) : null
      if (!event) continue
      // Its turn ended after it reported itself: the report said it all.
      if (event === 'done' && useDispatch.getState().reported[child.id]) {
        setReported(child.id, false)
        continue
      }
      setReported(child.id, false)
      queueReport(child, event)
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
