// Overview UI state (PRD F9): which view, what is selected / opened, the filter and folded groups.
// The view, folded groups and tray height are per-viewer conveniences kept in localStorage; losing them is harmless.
import { create } from 'zustand'
import type { SessionId } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { TRAY_HEIGHT, type OverviewGroupKey } from './model'
import { addToLayout, layoutIds, MAX_PANES, PICKER_SLOT, removeFromLayout, replaceInLayout, singleLayout, type PaneLayout, type Rect } from './pane-layout'

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
  /** The overlay shows one more tile for picking the next session to add; it sits in `layout` as PICKER_SLOT. */
  picking: boolean
  filter: string
  /** 一题多解: the attempt group the overlay compares (its members' tiles get a compare bar); null otherwise. */
  compareGroup: string | null
  /** Sessions picked with ⌘ / ⇧ for a batch action (F9 批量操作), in the order they were picked. */
  picked: SessionId[]
  /** Where a ⇧-click range starts: the last session clicked with or without ⌘. */
  pickAnchor: SessionId | null

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
  /** Opens the overlay on an attempt group's members, side by side. */
  openCompare(groupId: string, ids: readonly SessionId[]): void
  setPicked(ids: SessionId[], anchor?: SessionId | null): void
}

export const useOverviewStore = create<OverviewState>()((set, get) => ({
  ...loadPrefs(),
  selectedId: null,
  openId: null,
  layout: null,
  picking: false,
  filter: '',
  compareGroup: null,
  picked: [],
  pickAnchor: null,

  setView(view) {
    // The list's tray and the board's overlay are different things: switching closes whichever is open.
    set({ view, openId: null, layout: null, picking: false, compareGroup: null })
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
  openOverlay: (id) => set({ layout: id ? singleLayout(id) : null, picking: false, compareGroup: null, ...(id ? { selectedId: id } : {}) }),
  setLayout: (layout) => set({ layout }),
  addPane(id) {
    const { layout, picking } = get()
    const next = !layout ? singleLayout(id) : picking ? replaceInLayout(layout, PICKER_SLOT, id) : addToLayout(layout, id)
    set({ layout: next, picking: false, selectedId: id })
  },
  closePane(id) {
    const layout = get().layout
    const next = layout ? removeFromLayout(layout, id) : null
    // Closing the last terminal closes the overlay, picker included.
    set(next && layoutIds(next).length > 0 ? { layout: next } : { layout: null, picking: false, compareGroup: null })
  },
  setPicking(picking) {
    const layout = get().layout
    if (!layout || picking === get().picking) return
    // The picker is a tile of the layout while it shows, so the gaps around it resize like any other.
    set({ picking, layout: picking ? addToLayout(layout, PICKER_SLOT) : removeFromLayout(layout, PICKER_SLOT) })
  },
  setFilter: (filter) => set({ filter }),
  setTrayHeight(trayHeight) {
    set({ trayHeight })
    savePrefs({ ...prefsOf(get()), trayHeight })
  },
  setOverlayRect(overlayRect) {
    set({ overlayRect })
    savePrefs({ ...prefsOf(get()), overlayRect })
  },
  openCompare(groupId, ids) {
    const [first, ...rest] = ids.slice(0, MAX_PANES)
    if (!first) return
    // The overlay borrows the members' terminals: the list's tray gives its one back first.
    set({ layout: rest.reduce(addToLayout, singleLayout(first)), picking: false, openId: null, compareGroup: groupId, selectedId: first })
  },
  setPicked: (picked, anchor) => set({ picked, ...(anchor !== undefined ? { pickAnchor: anchor } : {}) })
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
  useOverviewStore.setState({ openId: null, layout: null, picking: false, compareGroup: null })
  useWorkspace.getState().setActiveSession(id)
}

/** 一题多解: the overview, with the overlay comparing the group's members (the main window comes forward). */
export function showCompare(groupId: string, ids: readonly SessionId[]): void {
  useOverviewStore.getState().openCompare(groupId, ids)
  useWorkspace.getState().setMainView('overview')
}
