// Whether the archive sheet (PRD F15, Figma 16D) is open, and for which worktree.
import { create } from 'zustand'
import { useWorkspace } from '../state/workspace'
import { archiveTargetFor, type ArchiveTarget } from './actions'

export const useArchiveSheet = create<{ target: ArchiveTarget | null; generation: number }>()(() => ({ target: null, generation: 0 }))

let restoreFocus: HTMLElement | null = null

export function openArchiveSheet(worktreeId: string): void {
  const target = archiveTargetFor(worktreeId)
  if (!target || target.isMain || useArchiveSheet.getState().target) return
  const active = document.activeElement
  restoreFocus = active instanceof HTMLElement && active !== document.body ? active : null
  useArchiveSheet.setState((s) => ({ target, generation: s.generation + 1 }))
}

export function closeArchiveSheet(refocus: boolean): void {
  if (!useArchiveSheet.getState().target) return
  useArchiveSheet.setState({ target: null })
  const back = restoreFocus
  restoreFocus = null
  if (refocus) requestAnimationFrame(() => (back?.isConnected ? back.focus() : useWorkspace.getState().requestTerminalFocus()))
}
