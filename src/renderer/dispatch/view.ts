// What a GUI dispatcher draws of its dispatch (Figma 68′): the fan-out graph where `wavi run` was called and the strip
// above the composer read the same view, so the two never disagree. A child is a session (dispatchedBy), or a request
// still waiting for 开始 (named in `wavi run`'s answer already); its own children hang under it. Pure.
import type { CliAgent } from '@shared/agents'
import type { PendingStart } from '@shared/dispatch'
import type { Session, SessionId } from '@shared/types'

/** `pending`: waits for 开始. `working` includes a child whose first turn has not begun (its agent is starting). */
export type NodeState = 'pending' | 'working' | 'attention' | 'done' | 'error' | 'exited'

export interface DispatchNode {
  id: SessionId
  /** Null for a session no longer in the workspace. */
  agent: CliAgent | null
  title: string
  model?: string
  /** A waiting request's task, its first line. */
  task?: string
  state: NodeState
  /** What it does now (编辑 src/auth/refresh.ts). */
  action?: string
  /** Epoch ms its clock counts from: the turn (working), the wait (attention), the session (done, up to `until`). */
  since?: number
  until?: number
  /** `+84 −3 · 2 个文件`, as its last report counted. */
  changes?: string
  /** A report of it reached this chat. */
  reported: boolean
  gone?: true
  children: DispatchNode[]
}

export interface DispatchInput {
  /** The children to draw, in order: the sessions `wavi run` named (one call), or all of a dispatcher's (the strip). */
  ids: readonly SessionId[]
  sessions: readonly Session[]
  confirms: readonly PendingStart[]
  changes: Readonly<Record<SessionId, string | undefined>>
  reported: ReadonlySet<SessionId>
}

export interface DispatchView {
  nodes: DispatchNode[]
  /** Every node, children included, by state (only states present). */
  counts: Partial<Record<NodeState, number>>
  /** The requests among these still waiting for 开始. */
  waiting: PendingStart[]
  /** How many of these sessions' reports reached the chat. */
  reports: number
  /** What needs the user most: the first error, else the first waiting for an answer. */
  urgent: DispatchNode | null
  /** Every node finished or went away (an error is not: it waits for the user). */
  settled: boolean
  settledAt?: number
}

function stateOf(s: Session): NodeState {
  if (s.phase === 'exited' || s.status === 'exited') return 'exited'
  if (s.status === 'error') return 'error'
  if (s.status === 'needs_you') return 'attention'
  if (s.status === 'running') return 'working'
  return s.finishedAt !== undefined ? 'done' : 'working'
}

function sessionNode(s: Session, input: DispatchInput, depth: number): DispatchNode {
  const state = stateOf(s)
  const clock =
    state === 'working' ? { since: s.turnStartedAt ?? s.startedAt } : state === 'attention' ? { since: s.statusSince ?? s.lastActivityAt } : { since: s.startedAt, ...(s.finishedAt !== undefined ? { until: s.finishedAt } : {}) }
  const changes = input.changes[s.id]
  return {
    id: s.id,
    agent: s.kind === 'shell' ? null : s.kind,
    title: s.title,
    ...(s.dispatchModel ? { model: s.dispatchModel } : {}),
    state,
    ...(s.currentAction && (state === 'working' || state === 'attention') ? { action: s.currentAction } : {}),
    ...clock,
    ...(changes ? { changes } : {}),
    reported: input.reported.has(s.id),
    // Two levels at most (PRD F21): a grandchild's own children are not drawn.
    children: depth === 1 ? input.sessions.filter((c) => c.dispatchedBy === s.id).map((c) => sessionNode(c, input, 2)) : []
  }
}

export function dispatchView(input: DispatchInput): DispatchView {
  const waiting: PendingStart[] = []
  const nodes = input.ids.map((id): DispatchNode => {
    const session = input.sessions.find((s) => s.id === id)
    if (session) return sessionNode(session, input, 1)
    const confirm = input.confirms.find((c) => c.childId === id)
    if (confirm) {
      waiting.push(confirm)
      const { item } = confirm.plan
      return { id, agent: item.agent, title: item.title, ...(item.model ? { model: item.model } : {}), task: item.task.split('\n', 1)[0], state: 'pending', children: [], reported: false }
    }
    return { id, agent: null, title: '', state: 'exited', reported: false, gone: true, children: [] }
  })
  const all = nodes.flatMap((n) => [n, ...n.children])
  const counts: Partial<Record<NodeState, number>> = {}
  for (const n of all) counts[n.state] = (counts[n.state] ?? 0) + 1
  const settled = all.length > 0 && all.every((n) => n.state === 'done' || n.state === 'exited')
  const ends = all.flatMap((n) => (n.until !== undefined ? [n.until] : []))
  return {
    nodes,
    counts,
    waiting,
    reports: all.filter((n) => n.reported).length,
    urgent: all.find((n) => n.state === 'error') ?? all.find((n) => n.state === 'attention') ?? null,
    settled,
    ...(settled && ends.length > 0 ? { settledAt: Math.max(...ends) } : {})
  }
}

/** The strip shows while anything is under way, and after everything ended until the dispatcher's next message. */
export function stripShown(view: DispatchView, lastUserAt: number | null): boolean {
  if (view.nodes.length === 0) return false
  if (!view.settled) return true
  return lastUserAt === null || view.settledAt === undefined || lastUserAt < view.settledAt
}
