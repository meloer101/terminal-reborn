// What dispatch (PRD F21) keeps in a window, none of it saved (who dispatched whom is on the sessions themselves):
// `wavi run` requests waiting for the user's 开始, the first message a child starts with, each child's last message,
// the reports on their way to each dispatcher, and messages held for 送进去 — when the session has no channel, nobody
// should be typed over, delivery failed, or the hourly budget is used.
import { create } from 'zustand'
import { emptyQueue, type ChildReport, type HeldItem, type PendingStart, type ReportQueue } from '@shared/dispatch'

export type { HeldItem, PendingStart } from '@shared/dispatch'
import type { SessionId } from '@shared/types'

interface State {
  confirms: PendingStart[]
  /** One-shot spawn extras for a child's first launch (taken by the terminal). */
  launches: Record<SessionId, { initialPrompt: string; model?: string } | undefined>
  /** A child's last message, whole (the Stop hook's `last_assistant_message`, tail-clipped by main). */
  messages: Record<SessionId, string | undefined>
  queues: Record<SessionId, ReportQueue | undefined>
  held: Record<SessionId, HeldItem[] | undefined>
  /** Children that ran `wavi report` in their current turn: its end needs no report of Wavi's own. */
  reported: Record<SessionId, true | undefined>
}

export const useDispatch = create<State>()(() => ({ confirms: [], launches: {}, messages: {}, queues: {}, held: {}, reported: {} }))

export function addConfirm(pending: PendingStart): void {
  useDispatch.setState((s) => ({ confirms: [...s.confirms, pending] }))
}

/** Takes these requests out of the waiting list; the ones still there (not answered by someone else meanwhile). */
export function takeConfirms(callIds: readonly string[]): PendingStart[] {
  const taken = useDispatch.getState().confirms.filter((c) => callIds.includes(c.callId))
  if (taken.length > 0) useDispatch.setState((s) => ({ confirms: s.confirms.filter((c) => !callIds.includes(c.callId)) }))
  return taken
}

export function setLaunch(id: SessionId, launch: { initialPrompt: string; model?: string }): void {
  useDispatch.setState((s) => ({ launches: { ...s.launches, [id]: launch } }))
}

/** The child's first message and model, once: a later spawn of the same session resumes instead. */
export function takeDispatchLaunch(id: SessionId): { initialPrompt: string; model?: string } | undefined {
  const launch = useDispatch.getState().launches[id]
  if (launch) useDispatch.setState((s) => ({ launches: { ...s.launches, [id]: undefined } }))
  return launch
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
