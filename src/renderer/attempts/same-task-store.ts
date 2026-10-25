// Whether the 同任务多解 dialog is open (PRD F4 v1.68, Figma 26D), for which session, and the tasks it can start
// from: text selected in its terminal, the plan its agent is waiting on, what the user said in it.
import { create } from 'zustand'
import { promptsTask, type TaskSource } from '@shared/attempt-groups'
import type { SessionId } from '@shared/types'
import { getSurface } from '../terminal/registry'
import { useWorkspace } from '../state/workspace'
import { planOf, promptsOf } from './sources'

export interface SourceText {
  source: TaskSource
  text: string
}

interface State {
  sessionId: SessionId | null
  /** In menu order; the first is where the dialog starts. */
  sources: SourceText[]
  generation: number
}

export const useSameTaskSheet = create<State>()(() => ({ sessionId: null, sources: [], generation: 0 }))

let restoreFocus: HTMLElement | null = null

/** Agent sessions only: the session it comes from sums the parts up afterwards. */
export function canRunSameTask(sessionId: SessionId | null): sessionId is SessionId {
  const session = sessionId ? useWorkspace.getState().sessions.find((s) => s.id === sessionId) : undefined
  return session !== undefined && session.kind !== 'shell'
}

/**
 * Opens the dialog for a session. Where the task starts: the given selection, else what is selected in its terminal,
 * else the plan it waits on, else what the user said in it; the others stay in the 任务 menu.
 */
export function openSameTask(sessionId: SessionId, selection?: string): void {
  if (!canRunSameTask(sessionId) || useSameTaskSheet.getState().sessionId) return
  const selected = (selection ?? getSurface(sessionId)?.getSelection() ?? '').trim()
  const plan = planOf(sessionId)
  const said = promptsTask(promptsOf(sessionId))
  const sources: SourceText[] = [
    ...(selected ? [{ source: 'selection' as const, text: selected }] : []),
    ...(plan ? [{ source: 'plan' as const, text: plan }] : []),
    ...(said ? [{ source: 'prompts' as const, text: said }] : [])
  ]
  const active = document.activeElement
  restoreFocus = active instanceof HTMLElement && active !== document.body ? active : null
  useSameTaskSheet.setState((s) => ({ sessionId, sources, generation: s.generation + 1 }))
}

/** ⇧⌘N and ⌘K: the session with the keyboard. */
export function openSameTaskForActive(): void {
  const id = useWorkspace.getState().activeSessionId
  if (canRunSameTask(id)) openSameTask(id)
}

export function closeSameTask(refocus: boolean): void {
  if (!useSameTaskSheet.getState().sessionId) return
  useSameTaskSheet.setState({ sessionId: null, sources: [] })
  const target = restoreFocus
  restoreFocus = null
  if (refocus) requestAnimationFrame(() => target?.focus())
}

export const isSameTaskOpen = (): boolean => useSameTaskSheet.getState().sessionId !== null
