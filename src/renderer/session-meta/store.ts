// Session metrics in the renderer (PRD F11 / F12): each session's context window and todo list, and the account's
// plan usage per vendor. Main sends only changes (and replays them to a reloaded window); usage comes from every
// session of a vendor and is kept by main across runs, so a fresh window asks for it once.
import { create } from 'zustand'
import type { AgentEvent } from '@shared/agent-events'
import type { ContextUsage, UsageVendor, VendorUsage } from '@shared/session-meta'
import type { TodoItem } from '@shared/todo-progress'
import type { SessionId } from '@shared/types'
import { useWorkspace } from '../state/workspace'

export interface SessionMetrics {
  context?: ContextUsage
  todos?: TodoItem[]
}

interface SessionMetaState {
  bySession: Record<SessionId, SessionMetrics>
  usage: Partial<Record<UsageVendor, VendorUsage>>
  setContext(sessionId: SessionId, context: ContextUsage | null): void
  setTodos(sessionId: SessionId, items: TodoItem[]): void
  setUsage(usage: VendorUsage): void
  /** Drops sessions that are gone. */
  retain(live: ReadonlySet<SessionId>): void
}

function patchSession(state: SessionMetaState, sessionId: SessionId, patch: (current: SessionMetrics) => SessionMetrics): Partial<SessionMetaState> {
  return { bySession: { ...state.bySession, [sessionId]: patch(state.bySession[sessionId] ?? {}) } }
}

export const useSessionMeta = create<SessionMetaState>()((set) => ({
  bySession: {},
  usage: {},
  setContext: (sessionId, context) =>
    set((s) =>
      patchSession(s, sessionId, (current) => {
        const next: SessionMetrics = { ...current }
        if (context) next.context = context
        else delete next.context
        return next
      })
    ),
  setTodos: (sessionId, items) =>
    set((s) =>
      patchSession(s, sessionId, (current) => {
        const next: SessionMetrics = { ...current }
        if (items.length > 0) next.todos = items
        else delete next.todos
        return next
      })
    ),
  setUsage: (usage) =>
    set((s) => {
      const held = s.usage[usage.vendor]
      return held && held.at > usage.at ? {} : { usage: { ...s.usage, [usage.vendor]: usage } }
    }),
  retain: (live) =>
    set((s) => {
      const ids = Object.keys(s.bySession)
      if (ids.every((id) => live.has(id))) return {}
      return { bySession: Object.fromEntries(Object.entries(s.bySession).filter(([id]) => live.has(id))) }
    })
}))

export function applyMetaEvent(sessionId: SessionId, event: AgentEvent): void {
  const state = useSessionMeta.getState()
  if (event.type === 'context') state.setContext(sessionId, event.context)
  else if (event.type === 'todos') state.setTodos(sessionId, event.items)
}

/** Listens to main; returns a function that stops listening. */
export function startSessionMetaBridge(): () => void {
  const offEvents = window.tr.agent.onEvent(({ sessionId, event }) => applyMetaEvent(sessionId, event))
  const offUsage = window.tr.agent.onUsage((usage) => useSessionMeta.getState().setUsage(usage))
  let live = true
  void window.tr.agent.getUsage().then((list) => {
    if (!live) return
    for (const usage of list) useSessionMeta.getState().setUsage(usage)
  })
  // Closed sessions take their metrics with them.
  const offSessions = useWorkspace.subscribe((state, prev) => {
    if (state.sessions !== prev.sessions) useSessionMeta.getState().retain(new Set(state.sessions.map((x) => x.id)))
  })
  return () => {
    live = false
    offEvents()
    offUsage()
    offSessions()
  }
}

// End-to-end tests drive states that need a real vendor (Codex, high usage) through the store directly.
if ((globalThis as { __TR_E2E__?: boolean }).__TR_E2E__ === true) {
  ;(globalThis as { __trSessionMeta?: typeof useSessionMeta }).__trSessionMeta = useSessionMeta
}
