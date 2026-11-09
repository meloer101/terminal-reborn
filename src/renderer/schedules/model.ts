// What the window decides when a 定时任务 comes due (PRD F24): pure, so the rules are tested without a window.
import { AGENT_SPECS } from '@shared/agents'
import { clock } from '@shared/schedule'
import type { VendorUsage } from '@shared/session-meta'
import type { Session, SessionId } from '@shared/types'

/** The account-wide limit is used up and has not reset: `Codex 额度用完，11:20 恢复`. */
export function quotaBlock(label: string, usage: VendorUsage | undefined, now: number): string | null {
  const full = usage?.windows.find((w) => w.scope === undefined && w.percent >= 100 && (w.resetsAt === undefined || w.resetsAt > now))
  if (!full) return null
  return full.resetsAt !== undefined ? `${label} 额度用完，${clock(full.resetsAt)} 恢复` : `${label} 额度用完`
}

/** The task's last session is still working or waiting on the user: this run would pile onto it. */
export function previousRunActive(sessions: readonly Session[], scheduleId: string): boolean {
  return sessions.some((s) => s.scheduledBy?.id === scheduleId && (s.status === 'running' || s.status === 'needs_you'))
}

/**
 * Whether a message can be sent into this session on a schedule: a GUI session always; a terminal one only when its
 * agent reports when a turn ends (hooks or OSC 7501). The 10 CLIs read from the title cannot tell (Figma 67F′).
 */
export function canReceive(session: Session): boolean {
  if (session.kind === 'shell') return false
  return session.ui === 'gui' || AGENT_SPECS[session.kind].status !== 'title'
}

export type SendStep = { type: 'send' } | { type: 'wait' } | { type: 'skip'; reason: string } | { type: 'fail'; reason: string }

/** What to do with the session a 发给已有会话 task writes to, right now. */
export function sendStep(session: Session | undefined, archived: boolean): SendStep {
  if (!session || archived) return { type: 'fail', reason: '会话已关闭或归档' }
  if (!canReceive(session)) return { type: 'fail', reason: '看不出空闲' }
  if (session.phase === 'exited' || session.status === 'exited') return { type: 'fail', reason: 'agent 已经退出' }
  if (session.status === 'needs_you') return { type: 'skip', reason: '会话在等你处理' }
  if (session.status === 'running') return { type: 'wait' }
  return { type: 'send' }
}

/** A run's worktree after its turn: nothing uncommitted and nothing committed on top of its base. */
export function unchanged(listing: { dirtyCount: number | null; ahead: number | null } | undefined): boolean {
  return listing !== undefined && listing.dirtyCount === 0 && listing.ahead === 0
}

/** A branch name not taken yet: `name`, then `name-2`, `name-3`, … */
export function freeBranch(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name
  for (let i = 2; ; i++) if (!taken.has(`${name}-${i}`)) return `${name}-${i}`
}

/** `--at 14:30` is its next time (today, else tomorrow); `--at 2026-11-12T09:00` that moment. */
export function onceAt(at: string, now: number): number | null {
  const [day, time] = at.includes('T') ? at.split('T') : [null, at]
  const [h, m] = (time ?? '').split(':').map(Number)
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return null
  if (day) {
    const [y, mo, d] = day.split('-').map(Number)
    const t = new Date(y ?? 0, (mo ?? 1) - 1, d ?? 1, h, m).getTime()
    return t > now ? t : null
  }
  const today = new Date(now)
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m).getTime()
  return t > now ? t : t + 24 * 60 * 60 * 1000
}

/** Requests waiting, per session (its 等你处理 label). */
export function scheduleRequestCounts(pending: ReadonlyArray<{ sessionId: SessionId }>): Map<SessionId, number> {
  const counts = new Map<SessionId, number>()
  for (const r of pending) counts.set(r.sessionId, (counts.get(r.sessionId) ?? 0) + 1)
  return counts
}
