// What dispatch (PRD F21) keeps in a window (who dispatched whom is on the sessions themselves): `wavi run` requests
// waiting for the user's 开始, the first message a child starts with, each child's last message, the reports on their
// way to each dispatcher, and messages held for 送进去 — when the session has no channel, nobody should be typed over,
// delivery failed, or the hourly budget is used. The waits, the queues and the held messages are saved with the
// workspace (saved-runs.ts), so a reload does not drop what an agent was promised.
import type { CliPermission } from '@shared/gui-chat'
import { create } from 'zustand'
import { emptyQueue, type ChildReport, type HeldItem, type PendingStart, type ReportQueue } from '@shared/dispatch'

export type { HeldItem, PendingStart } from '@shared/dispatch'
import type { SavedDispatch } from '@shared/saved-runs'
import type { SessionId } from '@shared/types'

interface State {
  confirms: PendingStart[]
  /** One-shot spawn extras for a child's first launch (taken by the terminal). */
  launches: Record<SessionId, DispatchLaunch | undefined>
  /** A child's last message, whole (the Stop hook's `last_assistant_message`, tail-clipped by main). */
  messages: Record<SessionId, string | undefined>
  queues: Record<SessionId, ReportQueue | undefined>
  held: Record<SessionId, HeldItem[] | undefined>
  /** Children that ran `wavi report` in their current turn: its end needs no report of Wavi's own. */
  reported: Record<SessionId, true | undefined>
  /** A child's `+84 −3 · 2 个文件` as its last report counted, for the GUI dispatcher's graph (Figma 68′). Not saved. */
  changes: Record<SessionId, string | undefined>
}

export const useDispatch = create<State>()(() => ({ confirms: [], launches: {}, messages: {}, queues: {}, held: {}, reported: {}, changes: {} }))

/** What a reload must not lose (null: nothing). */
export function savedDispatch(state: Pick<State, 'confirms' | 'queues' | 'held'>): SavedDispatch | null {
  const queues: SavedDispatch['queues'] = {}
  for (const [id, queue] of Object.entries(state.queues)) if (queue && (queue.pending.length > 0 || queue.sent.length > 0 || queue.seen.length > 0)) queues[id] = queue
  const held: SavedDispatch['held'] = {}
  for (const [id, items] of Object.entries(state.held)) if (items && items.length > 0) held[id] = items
  return state.confirms.length > 0 || Object.keys(queues).length > 0 || Object.keys(held).length > 0 ? { confirms: state.confirms, queues, held } : null
}

/** Takes up what an earlier window saved; what this window already has wins. */
export function restoreDispatch(saved: SavedDispatch | undefined): void {
  if (!saved) return
  useDispatch.setState((s) => {
    const known = new Set(s.confirms.map((c) => c.callId))
    return {
      confirms: [...s.confirms, ...saved.confirms.filter((c) => !known.has(c.callId))],
      queues: { ...saved.queues, ...s.queues },
      held: { ...saved.held, ...s.held }
    }
  })
}

export function addConfirm(pending: PendingStart): void {
  useDispatch.setState((s) => ({ confirms: [...s.confirms, pending] }))
}

/** Takes these requests out of the waiting list; the ones still there (not answered by someone else meanwhile). */
export function takeConfirms(callIds: readonly string[]): PendingStart[] {
  const taken = useDispatch.getState().confirms.filter((c) => callIds.includes(c.callId))
  if (taken.length > 0) useDispatch.setState((s) => ({ confirms: s.confirms.filter((c) => !callIds.includes(c.callId)) }))
  return taken
}

/** A new session's first launch: its first message, model and (a 定时任务's, PRD F24) 权限 for a CLI's launch flag. */
export interface DispatchLaunch {
  initialPrompt: string
  model?: string
  permission?: CliPermission
}

export function setLaunch(id: SessionId, launch: DispatchLaunch): void {
  useDispatch.setState((s) => ({ launches: { ...s.launches, [id]: launch } }))
}

/** The child's first message and model, once: a later spawn of the same session resumes instead. */
export function takeDispatchLaunch(id: SessionId): DispatchLaunch | undefined {
  const launch = useDispatch.getState().launches[id]
  if (launch) useDispatch.setState((s) => ({ launches: { ...s.launches, [id]: undefined } }))
  return launch
}

export function setChanges(id: SessionId, changes: string | undefined): void {
  if (useDispatch.getState().changes[id] === changes) return
  useDispatch.setState((s) => ({ changes: { ...s.changes, [id]: changes } }))
}

export function setMessage(id: SessionId, message: string): void {
  useDispatch.setState((s) => ({ messages: { ...s.messages, [id]: message } }))
}

export function queueOf(parentId: SessionId): ReportQueue {
  return useDispatch.getState().queues[parentId] ?? emptyQueue()
}

export function setQueue(parentId: SessionId, queue: ReportQueue): void {
  useDispatch.setState((s) => ({ queues: { ...s.queues, [parentId]: queue } }))
}

const sameItem = (a: HeldItem, b: HeldItem): boolean =>
  a.kind === 'report' && b.kind === 'report' ? a.report.childId === b.report.childId : a.kind === 'message' && b.kind === 'message' && a.key === b.key

export function addHeld(sessionId: SessionId, items: readonly HeldItem[]): void {
  if (items.length === 0) return
  useDispatch.setState((s) => {
    const kept = (s.held[sessionId] ?? []).filter((old) => !items.some((n) => sameItem(old, n)))
    return { held: { ...s.held, [sessionId]: [...kept, ...items] } }
  })
}

export const heldReports = (reports: readonly ChildReport[]): HeldItem[] => reports.map((report) => ({ kind: 'report', report }))

export function takeHeld(sessionId: SessionId): HeldItem[] {
  const held = useDispatch.getState().held[sessionId] ?? []
  if (held.length > 0) useDispatch.setState((s) => ({ held: { ...s.held, [sessionId]: undefined } }))
  return held
}

export function setReported(childId: SessionId, reported: boolean): void {
  if (Boolean(useDispatch.getState().reported[childId]) === reported) return
  useDispatch.setState((s) => ({ reported: { ...s.reported, [childId]: reported ? true : undefined } }))
}
