// What dispatch (PRD F21) keeps in a window, none of it saved (who dispatched whom is on the sessions themselves):
// batches waiting for the user's 开始, the first message a child starts with, each child's last message, and the
// reports on their way to each dispatcher — or held for 送进去 when there is no channel or the hourly budget is used.
import { create } from 'zustand'
import { emptyQueue, type ChildPlan, type ChildReport, type ReportQueue } from '@shared/dispatch'
import type { SessionId } from '@shared/types'

export interface PendingStart {
  callId: string
  parentId: SessionId
  plans: ChildPlan[]
  base: string
  reason?: string
  /** The dispatcher's checkout has uncommitted changes, which the new worktrees will not have. */
  uncommitted: boolean
  decide: (start: boolean) => void
}

interface State {
  confirms: PendingStart[]
  /** One-shot spawn extras for a child's first launch (taken by the terminal). */
  launches: Record<SessionId, { initialPrompt: string; model?: string } | undefined>
  /** A child's last message, whole (the Stop hook's `last_assistant_message`, tail-clipped by main). */
  messages: Record<SessionId, string | undefined>
  queues: Record<SessionId, ReportQueue | undefined>
  held: Record<SessionId, ChildReport[] | undefined>
}

export const useDispatch = create<State>()(() => ({ confirms: [], launches: {}, messages: {}, queues: {}, held: {} }))

export function addConfirm(pending: PendingStart): void {
  useDispatch.setState((s) => ({ confirms: [...s.confirms, pending] }))
}

export function settleConfirm(callId: string, start: boolean): void {
  const pending = useDispatch.getState().confirms.find((c) => c.callId === callId)
  if (!pending) return
  useDispatch.setState((s) => ({ confirms: s.confirms.filter((c) => c.callId !== callId) }))
  pending.decide(start)
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

export function addHeld(parentId: SessionId, reports: readonly ChildReport[]): void {
  useDispatch.setState((s) => {
    const kept = (s.held[parentId] ?? []).filter((r) => !reports.some((n) => n.childId === r.childId))
    return { held: { ...s.held, [parentId]: [...kept, ...reports] } }
  })
}

export function takeHeld(parentId: SessionId): ChildReport[] {
  const held = useDispatch.getState().held[parentId] ?? []
  if (held.length > 0) useDispatch.setState((s) => ({ held: { ...s.held, [parentId]: undefined } }))
  return held
}
