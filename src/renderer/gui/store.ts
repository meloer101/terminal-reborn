// GUI sessions in the renderer (PRD F23): each one's conversation as main reports it (folded with applyGuiEvent), its
// composer draft and attachments, and the keyboard requests for its composer. One store for all of them; components
// select their own session's slice, and applyGuiEvent keeps unchanged parts by identity, so a streamed delta re-renders
// only what it touched.
import { create } from 'zustand'
import { applyGuiEvent, emptyGuiState, type GuiEvent, type GuiState } from '@shared/gui-chat'
import type { SessionId } from '@shared/types'
import { reportLaunchIssue } from '../lifecycle/launch-issues'
import { drafts as savedDrafts } from '../state/persistence'
import { useWorkspace } from '../state/workspace'
import { appendToDraft } from './model'

interface GuiSessionsState {
  states: Record<SessionId, GuiState | undefined>
  /** Composer text by session (saved with the workspace, see `setDraft`). */
  drafts: Record<SessionId, string | undefined>
  /** Files to send with the next message (paperclip, drop, paste, the header's attach). */
  attachments: Record<SessionId, readonly string[] | undefined>
  /** Bumped when the session's composer should take the keyboard. */
  focus: Record<SessionId, number | undefined>
}

export const useGuiSessions = create<GuiSessionsState>(() => ({ states: {}, drafts: {}, attachments: {}, focus: {} }))

/** Whether a session is a GUI session (no terminal, PRD F23). */
export function isGuiSession(sessionId: SessionId): boolean {
  return useWorkspace.getState().sessions.some((s) => s.id === sessionId && s.ui === 'gui')
}

export function guiStateOf(sessionId: SessionId): GuiState {
  return useGuiSessions.getState().states[sessionId] ?? emptyGuiState()
}

/** Main's answer to `open`: the whole state to draw. */
export function setGuiState(sessionId: SessionId, state: GuiState): void {
  useGuiSessions.setState((s) => ({ states: { ...s.states, [sessionId]: state } }))
}

/** Events for one session, folded in order (they arrive batched per session). */
export function applyGuiEvents(sessionId: SessionId, events: readonly GuiEvent[]): void {
  if (events.length === 0) return
  useGuiSessions.setState((s) => {
    const before = s.states[sessionId] ?? emptyGuiState()
    const after = events.reduce(applyGuiEvent, before)
    return after === before ? s : { states: { ...s.states, [sessionId]: after } }
  })
}

let listening: (() => void) | null = null

/**
 * Starts listening to main's GUI events (once; every window's sessions come through the main window). An agent process
 * that dies leaves the session exited, as a terminal that could not start does (lifecycle/launch-issues).
 */
export function listenToGuiEvents(): void {
  listening ??= window.tr.gui.onEvents((sessionId, events) => {
    applyGuiEvents(sessionId, events)
    for (const event of events) if (event.type === 'failure' && event.failure) reportLaunchIssue(sessionId, { kind: 'spawn-failed', message: event.failure })
  })
}

// --- the composer draft ---------------------------------------------------------------------------------------------

const SAVE_DRAFT_MS = 500
const pendingSaves = new Map<SessionId, ReturnType<typeof setTimeout>>()

/** The composer text; it is saved with the workspace a moment after typing stops (not on every key). */
export function draftOf(sessionId: SessionId): string {
  return useGuiSessions.getState().drafts[sessionId] ?? savedDrafts.get(sessionId)
}

export function setDraft(sessionId: SessionId, text: string): void {
  useGuiSessions.setState((s) => (s.drafts[sessionId] === text ? s : { drafts: { ...s.drafts, [sessionId]: text } }))
  clearTimeout(pendingSaves.get(sessionId))
  pendingSaves.set(
    sessionId,
    setTimeout(() => {
      pendingSaves.delete(sessionId)
      // The session may be gone (its draft went with it).
      if (useWorkspace.getState().sessions.some((s) => s.id === sessionId)) savedDrafts.set(sessionId, text)
    }, SAVE_DRAFT_MS)
  )
}

/** Text another feature puts into the session's input (the files view, a review comment, …), after what is typed. */
export function insertIntoDraft(sessionId: SessionId, text: string): void {
  setDraft(sessionId, appendToDraft(draftOf(sessionId), text))
  requestComposerFocus(sessionId)
}

export function addAttachments(sessionId: SessionId, paths: readonly string[]): void {
  if (paths.length === 0) return
  useGuiSessions.setState((s) => {
    const next = [...new Set([...(s.attachments[sessionId] ?? []), ...paths])]
    return { attachments: { ...s.attachments, [sessionId]: next } }
  })
  requestComposerFocus(sessionId)
}

export function removeAttachment(sessionId: SessionId, path: string): void {
  useGuiSessions.setState((s) => ({ attachments: { ...s.attachments, [sessionId]: (s.attachments[sessionId] ?? []).filter((p) => p !== path) } }))
}

export function clearComposer(sessionId: SessionId): void {
  setDraft(sessionId, '')
  useGuiSessions.setState((s) => ({ attachments: { ...s.attachments, [sessionId]: [] } }))
}

export function requestComposerFocus(sessionId: SessionId): void {
  useGuiSessions.setState((s) => ({ focus: { ...s.focus, [sessionId]: (s.focus[sessionId] ?? 0) + 1 } }))
}

/** Forgets closed sessions (their agent processes are ended by the caller). */
export function forgetGuiSessions(alive: ReadonlySet<SessionId>): SessionId[] {
  const { states, drafts, attachments, focus } = useGuiSessions.getState()
  const gone = Object.keys(states).filter((id) => !alive.has(id))
  if (gone.length === 0) return gone
  const keep = <T>(record: Record<SessionId, T>): Record<SessionId, T> => Object.fromEntries(Object.entries(record).filter(([id]) => alive.has(id)))
  useGuiSessions.setState({ states: keep(states), drafts: keep(drafts), attachments: keep(attachments), focus: keep(focus) })
  for (const id of gone) {
    clearTimeout(pendingSaves.get(id))
    pendingSaves.delete(id)
  }
  return gone
}
