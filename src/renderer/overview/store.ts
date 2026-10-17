// Overview UI state (PRD F9): which view, what is selected / opened, the filter and folded groups.
// The view, folded groups and tray height are per-viewer conveniences kept in localStorage; losing them is harmless.
import { create } from 'zustand'
import type { SessionId } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { TRAY_HEIGHT, type OverviewGroupKey } from './model'

export type OverviewView = 'list' | 'board'

const PREFS_KEY = 'tr.overview.v1'

interface Prefs {
  view: OverviewView
  collapsed: OverviewGroupKey[]
  /** Height of the list's in-place terminal, before clamping to the window. */
  trayHeight: number
}

const DEFAULT_PREFS: Prefs = { view: 'list', collapsed: ['exited'], trayHeight: TRAY_HEIGHT.initial }

function loadPrefs(): Prefs {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(PREFS_KEY) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFS
    const value = raw as Partial<Prefs>
    return {
      view: value.view === 'board' ? 'board' : 'list',
      collapsed: Array.isArray(value.collapsed) ? value.collapsed.filter((k): k is OverviewGroupKey => typeof k === 'string') : DEFAULT_PREFS.collapsed,
      trayHeight: typeof value.trayHeight === 'number' && Number.isFinite(value.trayHeight) ? value.trayHeight : DEFAULT_PREFS.trayHeight
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Not saved; the defaults come back next time.
  }
}

interface OverviewState extends Prefs {
  selectedId: SessionId | null
  /** Session whose terminal is open: expanded in place in the list, or in the overlay over the board. */
  openId: SessionId | null
  filter: string

  setView(view: OverviewView): void
  toggleGroup(key: OverviewGroupKey): void
  select(id: SessionId | null): void
  setOpen(id: SessionId | null): void
  setFilter(filter: string): void
  setTrayHeight(height: number): void
}

export const useOverviewStore = create<OverviewState>()((set, get) => ({
  ...loadPrefs(),
  selectedId: null,
  openId: null,
  filter: '',

  setView(view) {
    // The list's tray and the board's overlay are different things: switching closes whichever is open.
    set({ view, openId: null })
    savePrefs({ ...prefsOf(get()), view })
  },
  toggleGroup(key) {
    const collapsed = get().collapsed.includes(key) ? get().collapsed.filter((k) => k !== key) : [...get().collapsed, key]
    set({ collapsed })
    savePrefs({ ...prefsOf(get()), collapsed })
  },
  // Moving the selection leaves the open terminal where it is (a 420 px tray jumping with every ↓ is disorienting).
  select: (id) => set({ selectedId: id }),
  setOpen: (id) => set({ openId: id, ...(id ? { selectedId: id } : {}) }),
  setFilter: (filter) => set({ filter }),
  setTrayHeight(trayHeight) {
    set({ trayHeight })
    savePrefs({ ...prefsOf(get()), trayHeight })
  }
}))

function prefsOf({ view, collapsed, trayHeight }: Prefs): Prefs {
  return { view, collapsed, trayHeight }
}

/** ⌘⇧A, the sidebar entry and ⌘K: show the overview, or go back to the session it was opened from. */
export function toggleOverview(): void {
  const workspace = useWorkspace.getState()
  workspace.setMainView(workspace.mainView === 'overview' ? 'session' : 'overview')
}

/** Leaves the overview for a session's terminal. */
export function enterSession(id: SessionId): void {
  useOverviewStore.getState().setOpen(null)
  useWorkspace.getState().setActiveSession(id)
}
