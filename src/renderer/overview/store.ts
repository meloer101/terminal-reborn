// Overview UI state (PRD F9): which view, what is selected / opened, the filter and folded groups.
// The view, folded groups and tray height are per-viewer conveniences kept in localStorage; losing them is harmless.
import { create } from 'zustand'
import type { SessionId } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { TRAY_HEIGHT, type OverviewGroupKey } from './model'
import { addToLayout, removeFromLayout, singleLayout, type PaneLayout, type Rect } from './pane-layout'

export type OverviewView = 'list' | 'board'

const PREFS_KEY = 'tr.overview.v1'

interface Prefs {
  view: OverviewView
  collapsed: OverviewGroupKey[]
  /** Height of the list's in-place terminal, before clamping to the window. */
  trayHeight: number
  /** Where the board overlay sits once its edges were dragged (window px); null = the default, centered (PRD F9). */
  overlayRect: Rect | null
}

const DEFAULT_PREFS: Prefs = { view: 'list', collapsed: ['exited'], trayHeight: TRAY_HEIGHT.initial, overlayRect: null }

function loadPrefs(): Prefs {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(PREFS_KEY) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFS
    const value = raw as Partial<Prefs>
    return {
      view: value.view === 'board' ? 'board' : 'list',
      collapsed: Array.isArray(value.collapsed) ? value.collapsed.filter((k): k is OverviewGroupKey => typeof k === 'string') : DEFAULT_PREFS.collapsed,
      trayHeight: typeof value.trayHeight === 'number' && Number.isFinite(value.trayHeight) ? value.trayHeight : DEFAULT_PREFS.trayHeight,
      overlayRect: isRect(value.overlayRect) ? value.overlayRect : null
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function isRect(value: unknown): value is Rect {
  if (typeof value !== 'object' || value === null) return false
  const { x, y, width, height } = value as Partial<Rect>
  return [x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))
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
  /** Session whose terminal is expanded in place in the list. */
  openId: SessionId | null
  /** The sessions tiled in the overlay over the board (at most four, pane-layout.ts); null = closed. */
  layout: PaneLayout | null
  /** The overlay shows one more tile for picking the next session to add. */
  picking: boolean
  filter: string

  setView(view: OverviewView): void
  toggleGroup(key: OverviewGroupKey): void
  select(id: SessionId | null): void
  setOpen(id: SessionId | null): void
  /** Opens the board's overlay on just this session (a card click), or closes it with null. */
  openOverlay(id: SessionId | null): void
  setLayout(layout: PaneLayout): void
  addPane(id: SessionId): void
  closePane(id: SessionId): void
  setPicking(picking: boolean): void
  setFilter(filter: string): void
  setTrayHeight(height: number): void
  setOverlayRect(rect: Rect | null): void
}

export const useOverviewStore = create<OverviewState>()((set, get) => ({
  ...loadPrefs(),
  selectedId: null,
  openId: null,
  layout: null,
  picking: false,
  filter: '',

  setView(view) {
    // The list's tray and the board's overlay are different things: switching closes whichever is open.
    set({ view, openId: null, layout: null, picking: false })
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
  openOverlay: (id) => set({ layout: id ? singleLayout(id) : null, picking: false, ...(id ? { selectedId: id } : {}) }),
  setLayout: (layout) => set({ layout }),
  addPane(id) {
    const layout = get().layout
    set({ layout: layout ? addToLayout(layout, id) : singleLayout(id), picking: false, selectedId: id })
  },
  closePane(id) {
    const layout = get().layout
    const next = layout ? removeFromLayout(layout, id) : null
    // Closing the last terminal closes the overlay, picker included.
    set(next && next.columns.length > 0 ? { layout: next } : { layout: null, picking: false })
  },
  setPicking: (picking) => set({ picking }),
  setFilter: (filter) => set({ filter }),
  setTrayHeight(trayHeight) {
    set({ trayHeight })
    savePrefs({ ...prefsOf(get()), trayHeight })
  },
  setOverlayRect(overlayRect) {
    set({ overlayRect })
    savePrefs({ ...prefsOf(get()), overlayRect })
  }
}))

function prefsOf({ view, collapsed, trayHeight, overlayRect }: Prefs): Prefs {
  return { view, collapsed, trayHeight, overlayRect }
}

/** ⌘⇧A, the sidebar entry and ⌘K: show the overview, or go back to the session it was opened from. */
export function toggleOverview(): void {
  const workspace = useWorkspace.getState()
  workspace.setMainView(workspace.mainView === 'overview' ? 'session' : 'overview')
}

/** Leaves the overview for a session's terminal. */
export function enterSession(id: SessionId): void {
  useOverviewStore.setState({ openId: null, layout: null, picking: false })
  useWorkspace.getState().setActiveSession(id)
}
