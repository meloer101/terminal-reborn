import type { Session, SessionStatus } from './types'

/** Statuses that pull the user in: shown in the sidebar's top queue and counted on the Dock badge. */
export function needsAttention(status: SessionStatus): boolean {
  return status === 'needs_you' || status === 'error' || status === 'done_unread'
}

/** Lower sorts first. "Needs you" is the single loudest state. */
const SORT_ORDER: Record<SessionStatus, number> = {
  needs_you: 0,
  error: 1,
  done_unread: 2,
  running: 3,
  idle: 4,
  exited: 5
}

export function compareByUrgency(a: Session, b: Session): number {
  return SORT_ORDER[a.status] - SORT_ORDER[b.status] || b.lastActivityAt - a.lastActivityAt
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  running: '运行中',
  needs_you: '等你处理',
  done_unread: '已完成',
  idle: '空闲',
  error: '出错',
  exited: '已退出'
}
