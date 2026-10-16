// Overview UI state (PRD F9): which view, what is selected / previewed, the filter and folded groups.
// The view and folded groups are per-viewer conveniences kept in localStorage; losing them is harmless.
import { create } from 'zustand'
import type { SessionId } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import type { OverviewGroupKey } from './model'

export type OverviewView = 'list' | 'board'

const PREFS_KEY = 'tr.overview.v1'

interface Prefs {
  view: OverviewView
  collapsed: OverviewGroupKey[]
}

const DEFAULT_PREFS: Prefs = { view: 'list', collapsed: ['exited'] }

function loadPrefs(): Prefs {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(PREFS_KEY) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFS
    const value = raw as Partial<Prefs>
    return {
      view: value.view === 'board' ? 'board' : 'list',
      collapsed: Array.isArray(value.collapsed) ? value.collapsed.filter((k): k is OverviewGroupKey => typeof k === 'string') : DEFAULT_PREFS.collapsed
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
  /** Session shown in the peek panel (Space), or null. */
  peekId: SessionId | null
  filter: string

  setView(view: OverviewView): void
  toggleGroup(key: OverviewGroupKey): void
  select(id: SessionId | null): void
  setPeek(id: SessionId | null): void
  setFilter(filter: string): void
}

export const useOverviewStore = create<OverviewState>()((set, get) => ({
  ...loadPrefs(),
  selectedId: null,
  peekId: null,
  filter: '',

  setView(view) {
    set({ view })
    savePrefs({ view, collapsed: get().collapsed })
  },
  toggleGroup(key) {
    const collapsed = get().collapsed.includes(key) ? get().collapsed.filter((k) => k !== key) : [...get().collapsed, key]
    set({ collapsed })
    savePrefs({ view: get().view, collapsed })
  },
  select: (id) => set((s) => ({ selectedId: id, peekId: s.peekId === null ? null : id })),
  setPeek: (id) => set({ peekId: id, ...(id ? { selectedId: id } : {}) }),
  setFilter: (filter) => set({ filter })
}))

/** ⌘⇧A, the sidebar entry and ⌘K: show the overview, or go back to the session it was opened from. */
export function toggleOverview(): void {
  const workspace = useWorkspace.getState()
  workspace.setMainView(workspace.mainView === 'overview' ? 'session' : 'overview')
}

/** Leaves the overview for a session's terminal. */
export function enterSession(id: SessionId): void {
  useOverviewStore.getState().setPeek(null)
  useWorkspace.getState().setActiveSession(id)
}
