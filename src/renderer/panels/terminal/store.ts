// Tabs of the 终端 view (PRD F17, Figma 76), per worktree: every session in the worktree shares them. Not saved: on
// mount the view adopts the worktree's shells the pty daemon still runs (actions.ts), so a reload finds them again.
import { create } from 'zustand'
import { nextPanelTerminalNumber, panelTerminalId, parsePanelTerminalId } from '@shared/panel-terminal'
import type { SessionId, WorktreeId } from '@shared/types'

export interface WorktreeTabs {
  /** PTY ids (`panel-<worktreeId>-<n>`), in the order they were opened. */
  ids: SessionId[]
  /** The tab shown; null only when there are none. */
  active: SessionId | null
}

interface PanelTerminalsState {
  worktrees: Record<WorktreeId, WorktreeTabs>
  /** The shell's own terminal title (OSC 0 / 2), by id; a tab without one shows the shell's name. */
  titles: Record<SessionId, string>
  /** Highest number handed out per worktree this run, so a closed tab's id (its process may still be ending) is not reused. */
  issued: Record<WorktreeId, number>
}

const NONE: WorktreeTabs = { ids: [], active: null }

export const usePanelTerminals = create<PanelTerminalsState>(() => ({ worktrees: {}, titles: {}, issued: {} }))

export const tabsOf = (worktreeId: WorktreeId): WorktreeTabs => usePanelTerminals.getState().worktrees[worktreeId] ?? NONE

const byNumber = (a: SessionId, b: SessionId): number => (parsePanelTerminalId(a)?.n ?? 0) - (parsePanelTerminalId(b)?.n ?? 0)

function patchWorktree(worktreeId: WorktreeId, next: WorktreeTabs): void {
  usePanelTerminals.setState((s) => {
    const worktrees = { ...s.worktrees }
    if (next.ids.length === 0) delete worktrees[worktreeId]
    else worktrees[worktreeId] = next
    return { worktrees }
  })
}

/** A new tab's id for the worktree: one past every number it has or had this run (`live`: ids the daemon still runs). */
export function nextTabId(worktreeId: WorktreeId, live: readonly SessionId[] = []): SessionId {
  const n = Math.max(nextPanelTerminalNumber([...tabsOf(worktreeId).ids, ...live], worktreeId), (usePanelTerminals.getState().issued[worktreeId] ?? 0) + 1)
  usePanelTerminals.setState((s) => ({ issued: { ...s.issued, [worktreeId]: n } }))
  return panelTerminalId(worktreeId, n)
}

/** Adds a tab (at the end) and shows it. */
export function addTab(id: SessionId): void {
  const ref = parsePanelTerminalId(id)
  if (!ref) return
  const tabs = tabsOf(ref.worktreeId)
  patchWorktree(ref.worktreeId, { ids: tabs.ids.includes(id) ? tabs.ids : [...tabs.ids, id].sort(byNumber), active: id })
}

/** Takes in the worktree's shells found running (a reload); the tab shown stays, or the first one is shown. */
export function adoptTabs(worktreeId: WorktreeId, ids: readonly SessionId[]): void {
  const tabs = tabsOf(worktreeId)
  const fresh = ids.filter((id) => parsePanelTerminalId(id)?.worktreeId === worktreeId && !tabs.ids.includes(id))
  if (fresh.length === 0) return
  const all = [...tabs.ids, ...fresh].sort(byNumber)
  patchWorktree(worktreeId, { ids: all, active: tabs.active ?? all[0]! })
}

/** Removes a tab; when it was shown, the one after it (else before it) is shown. */
export function removeTab(id: SessionId): void {
  const ref = parsePanelTerminalId(id)
  if (!ref) return
  const tabs = tabsOf(ref.worktreeId)
  const at = tabs.ids.indexOf(id)
  if (at < 0) return
  const ids = tabs.ids.filter((x) => x !== id)
  const active = tabs.active === id ? (ids[at] ?? ids[at - 1] ?? null) : tabs.active
  patchWorktree(ref.worktreeId, { ids, active })
  usePanelTerminals.setState((s) => {
    if (!(id in s.titles)) return {}
    const titles = { ...s.titles }
    delete titles[id]
    return { titles }
  })
}

export function selectTab(id: SessionId): void {
  const ref = parsePanelTerminalId(id)
  if (!ref) return
  const tabs = tabsOf(ref.worktreeId)
  if (tabs.ids.includes(id) && tabs.active !== id) patchWorktree(ref.worktreeId, { ...tabs, active: id })
}

/** The shell set its terminal title; an empty one falls back to the shell's name. */
export function setTabTitle(id: SessionId, title: string): void {
  const ref = parsePanelTerminalId(id)
  const trimmed = title.trim()
  if (!ref || !tabsOf(ref.worktreeId).ids.includes(id) || (usePanelTerminals.getState().titles[id] ?? '') === trimmed) return
  usePanelTerminals.setState((s) => {
    const titles = { ...s.titles }
    if (trimmed) titles[id] = trimmed
    else delete titles[id]
    return { titles }
  })
}
