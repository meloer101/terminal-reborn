// Whether the new-session sheet is open, and for which project (⌘N: the current one; a project's ＋: that one); and
// the installed agents its quicker sibling, 在此新建会话, lists at once.
import { create } from 'zustand'
import type { AgentAvailability } from '@shared/ipc'
import type { ProjectId } from '@shared/types'

export const useNewSessionSheet = create<{ open: boolean; projectId: ProjectId | null; generation: number }>()(() => ({
  open: false,
  projectId: null,
  generation: 0
}))

let restoreFocus: HTMLElement | null = null

export function openNewSessionSheet(projectId: ProjectId | null): void {
  if (useNewSessionSheet.getState().open) return
  const active = document.activeElement
  restoreFocus = active instanceof HTMLElement && active !== document.body ? active : null
  useNewSessionSheet.setState((s) => ({ open: true, projectId, generation: s.generation + 1 }))
}

/** `refocus`: give the keyboard back to what had it (cancel); after 创建 the new session's terminal takes it instead. */
export function closeNewSessionSheet(refocus: boolean): void {
  if (!useNewSessionSheet.getState().open) return
  useNewSessionSheet.setState({ open: false })
  const target = restoreFocus
  restoreFocus = null
  // After React removes the sheet, so the key that closed it does not land in the restored element.
  if (refocus) requestAnimationFrame(() => target?.focus())
}

export const isNewSessionSheetOpen = (): boolean => useNewSessionSheet.getState().open

let lastFound: AgentAvailability | null = null

/**
 * Which agent CLIs are installed, for a menu that must open at once (在此新建会话): the last answer, asking again
 * behind it; only the first time waits for main (which caches its own answer for a few seconds).
 */
export function installedAgents(): Promise<AgentAvailability | null> {
  const next = window.tr.app
    .detectAgents()
    .then((found) => (lastFound = found))
    .catch(() => lastFound)
  return lastFound ? Promise.resolve(lastFound) : next
}
