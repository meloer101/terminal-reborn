// Whether 创建 PR 面板 (PRD F16 v1.63, Figma 22A) is open, and for which worktree. Opened from Git · 变更's PR button,
// which since v1.68 may also commit first (提交并创建 PR) or push to the branch's open PR (提交并推送 / 推送).
import { create } from 'zustand'
import type { SessionId } from '@shared/types'
import type { ShipMode } from './ship-model'

export interface CreatePrTarget {
  /** The project's root (main only accepts workspace project roots). */
  root: string
  worktree: string
  /** The session title the PR title starts from. */
  title: string
  /** Where the PR opens afterwards (the session's built-in browser). */
  sessionId: SessionId | null
  /** The worktree's agent session: whose turn checks and review go into the evidence block. */
  agentSessionId: SessionId | null
  agent: 'claude' | 'codex' | null
  /** `pr`: create the PR; `push`: the branch has `openPr` already, so commit and push to it. */
  mode: ShipMode
  openPr: { number: number; url: string } | null
}

export const useCreatePr = create<{ target: CreatePrTarget | null; generation: number }>()(() => ({ target: null, generation: 0 }))

let restoreFocus: HTMLElement | null = null

export function openCreatePr(target: CreatePrTarget): void {
  if (useCreatePr.getState().target) return
  const active = document.activeElement
  restoreFocus = active instanceof HTMLElement && active !== document.body ? active : null
  useCreatePr.setState((s) => ({ target, generation: s.generation + 1 }))
}

export function closeCreatePr(): void {
  if (!useCreatePr.getState().target) return
  useCreatePr.setState({ target: null })
  const back = restoreFocus
  restoreFocus = null
  requestAnimationFrame(() => back?.isConnected && back.focus())
}
