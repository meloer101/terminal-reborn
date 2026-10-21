// Background review in the window (PRD F13): each worktree's latest status from main, the comments it lands in
// Git · 变更, and the turn signals main needs for 一轮结束且有新提交时. Main runs the reviewer; nothing here types into
// a session.
import { create } from 'zustand'
import { formatReviewStats, type ReviewAgent, type ReviewStatus, type ReviewTrigger } from '@shared/background-review'
import type { AgentEventEnvelope } from '@shared/agent-events'
import { landReviewComments } from '../state/review-comments'
import { useWorkspace } from '../state/workspace'

/** A worktree's latest review as the window keeps it: the comments themselves live in the comment store. */
export type ReviewState = Omit<ReviewStatus, 'comments'> & {
  /** How many comments the review landed. */
  found?: number
  /** Asked again for a diff that was already reviewed: the earlier result stands. */
  note?: string
}

export const useBackgroundReview = create<{ byRoot: Record<string, ReviewState> }>()(() => ({ byRoot: {} }))

/** What the window should keep after `next` arrives (pure). Null = keep `prev` as it is. */
export function nextReviewState(prev: ReviewState | undefined, next: ReviewStatus): ReviewState | null {
  // start()'s reply can arrive after the run already ended.
  if (prev && prev.startedAt === next.startedAt && prev.hash === next.hash && prev.phase !== 'running' && next.phase === 'running') return null
  if (next.phase === 'skipped' && prev && prev.hash === next.hash && prev.phase === 'done') return { ...prev, note: next.message }
  const { comments, cached, ...rest } = next
  if (cached) return { ...rest, note: '这份改动已经审过' }
  return comments ? { ...rest, found: comments.length } : rest
}

export function acceptReviewStatus(status: ReviewStatus): void {
  const next = nextReviewState(useBackgroundReview.getState().byRoot[status.root], status)
  if (!next) return
  if (status.phase === 'done' && status.comments) landReviewComments(status.root, status.comments)
  useBackgroundReview.setState((s) => ({ byRoot: { ...s.byRoot, [status.root]: next } }))
}

export async function startBackgroundReview(root: string, agent: ReviewAgent, trigger: ReviewTrigger, base?: string): Promise<ReviewStatus> {
  const status = await window.tr.review.start({ root, agent, trigger, ...(base ? { base } : {}) })
  acceptReviewStatus(status)
  return status
}

const loaded = new Set<string>()

/** After a restart: the worktree's saved result, unless this window already has a status for it. */
export function loadSavedReview(root: string): void {
  if (loaded.has(root)) return
  loaded.add(root)
  void window.tr.review.latest(root).then((status) => {
    if (status && !useBackgroundReview.getState().byRoot[root]) acceptReviewStatus(status)
  })
}

export function cancelBackgroundReview(root: string): void {
  window.tr.review.cancel(root)
}

/** The worktree path and agent of an agent session, or null for a terminal. */
function agentRoot(sessionId: string): { root: string; agent: ReviewAgent } | null {
  const state = useWorkspace.getState()
  const session = state.sessions.find((s) => s.id === sessionId)
  if (!session || (session.kind !== 'claude' && session.kind !== 'codex')) return null
  const worktree = state.worktrees.find((w) => w.id === session.worktreeId)
  return worktree ? { root: worktree.path, agent: session.kind } : null
}

function onAgentEvent({ sessionId, event }: AgentEventEnvelope): void {
  if (event.type !== 'prompt-submit' && event.type !== 'stop') return
  const where = agentRoot(sessionId)
  if (!where) return
  // Main decides whether to review (the switch, and whether HEAD moved during the turn).
  if (event.type === 'prompt-submit') window.tr.review.turnStarted(where.root)
  else window.tr.review.turnEnded(where.root, where.agent)
}

let listening = false

export function listenForBackgroundReview(): void {
  if (listening) return
  listening = true
  window.tr.review.onStatus(acceptReviewStatus)
  window.tr.agent.onEvent(onAgentEvent)
}

export interface ReviewLine {
  tone: 'working' | 'ok' | 'warn' | 'error' | 'muted'
  text: string
  /** Duration and cost, when known. */
  meta: string
  /** The reviewer's summary, for a tooltip. */
  detail?: string
}

/** One line for the status of a review. `counts` are the comments it landed (for P0–P3 totals). */
export function reviewLine(status: ReviewState, counts: string, sessionAgent?: ReviewAgent): ReviewLine {
  const meta = formatReviewStats(status.durationMs, status.costUsd)
  // Named only when 另一家来审 picked a different CLI than the session's.
  const reviewerName = sessionAgent && sessionAgent !== status.agent ? (status.agent === 'claude' ? 'Claude' : 'Codex') : ''
  switch (status.phase) {
    case 'running':
      return { tone: 'working', text: status.message || '正在审阅…', meta: '' }
    case 'done': {
      const found = status.found ?? 0
      const who = reviewerName ? `${reviewerName} ` : ''
      const hidden = status.hidden ? ` · 另有 ${status.hidden} 条你之前忽略过` : ''
      return {
        tone: found > 0 ? 'warn' : 'ok',
        text: `${status.note ? `${status.note}：` : ''}${found > 0 ? `${who}审阅找到 ${found} 条${counts ? `（${counts}）` : ''}` : `${who}审阅完成，没有发现问题`}${hidden}`,
        meta,
        ...(status.message ? { detail: status.message } : {})
      }
    }
    case 'failed':
      return { tone: 'error', text: `审阅失败：${status.message}`, meta }
    case 'cancelled':
      return { tone: 'muted', text: status.message, meta: '' }
    case 'skipped':
      return { tone: 'muted', text: status.message, meta: '' }
  }
}
