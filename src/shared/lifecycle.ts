// Pure rules for losing agents: when quitting or closing needs a confirmation, and what it says.
// Used by main (quit guard, menu) and the renderer (close session, remove project).
import type { SessionStatus } from './types'

/** A session whose agent would lose work if its process were killed now. */
export function isActiveStatus(status: SessionStatus): boolean {
  return status === 'running' || status === 'needs_you'
}

export function countActive(statuses: Iterable<SessionStatus>): number {
  let count = 0
  for (const status of statuses) if (isActiveStatus(status)) count++
  return count
}

/** What the renderer tells main about live work (for the quit confirmation). */
export interface ActivitySummary {
  /** Sessions that are running or waiting for the user. */
  active: number
}

/** Native confirmation dialog request (`window.tr.ui.confirm`). */
export interface ConfirmOptions {
  message: string
  detail?: string
  confirmLabel: string
  cancelLabel?: string
  /** Marks the confirm action as destructive: the safe choice is the default button. */
  destructive?: boolean
}

export type QuitDecision = 'quit' | 'confirm'

/**
 * Whether quitting needs the user's say-so. The OS forcing a quit (logout / shutdown) is never
 * blocked: a dialog there would hang the logout. Nothing is interrupted when the sessions keep running in the
 * pty daemon (`keepsSessions`), so that quit is not asked about either.
 */
export function decideQuit(input: { active: number; forced: boolean; keepsSessions?: boolean }): QuitDecision {
  if (input.forced || input.keepsSessions) return 'quit'
  return input.active > 0 ? 'confirm' : 'quit'
}

/** "退出并结束所有会话": asked only while something is running or waiting. */
export function endSessionsQuitConfirmation(active: number): ConfirmOptions | null {
  if (active <= 0) return null
  return {
    message: `有 ${active} 个会话正在运行或等你处理，结束后它们会中断。`,
    confirmLabel: '结束并退出',
    cancelLabel: '取消',
    destructive: true
  }
}

export function quitConfirmation(active: number): ConfirmOptions {
  return {
    message: `有 ${active} 个会话正在运行或等你处理，退出会中断它们。`,
    confirmLabel: '退出',
    cancelLabel: '取消',
    destructive: true
  }
}

/** Closing a session only needs a confirmation while its agent is running or waiting. */
export function closeSessionConfirmation(title: string, status: SessionStatus): ConfirmOptions | null {
  if (!isActiveStatus(status)) return null
  return {
    message: `「${title}」正在运行或等你处理，关闭会中断它。`,
    confirmLabel: '关闭会话',
    cancelLabel: '取消',
    destructive: true
  }
}

/** `active` is the number of the project's sessions that are running or waiting. */
export function removeProjectConfirmation(projectName: string, active: number): ConfirmOptions | null {
  if (active <= 0) return null
  return {
    message: `「${projectName}」有 ${active} 个会话正在运行或等你处理，移除项目会中断它们。`,
    confirmLabel: '移除项目',
    cancelLabel: '取消',
    destructive: true
  }
}

export function removeProjectMenuLabel(sessionCount: number): string {
  return sessionCount > 0 ? `移除项目并关闭 ${sessionCount} 个会话` : '从侧栏移除项目'
}

export type ViewMenuItem = 'reload' | 'toggleDevTools' | 'separator' | 'togglefullscreen'

/** View menu roles. Reload (⌘R) and DevTools would kill every agent / expose internals: dev builds only. */
export function viewMenuItems(isPackaged: boolean): ViewMenuItem[] {
  return isPackaged ? ['togglefullscreen'] : ['reload', 'toggleDevTools', 'separator', 'togglefullscreen']
}

/** `pty:host-restarted` payload: sessions whose terminal process died with the pty-host. */
export interface HostRestartedEvent {
  sessionIds: string[]
}

/**
 * Delay before restarting a crashed pty-host. `recentCrashes` counts crashes in the recent window
 * including this one; a crash loop backs off up to 30 s.
 */
export function hostRestartDelay(recentCrashes: number): number {
  const n = Math.max(1, Math.floor(recentCrashes))
  return Math.min(30_000, 500 * 2 ** (n - 1))
}
