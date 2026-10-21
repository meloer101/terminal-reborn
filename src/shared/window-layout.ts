// Several app windows (PRD F20 · 多窗口): the main window plus secondary windows, each with its own panes — a split
// tree and the pane the keyboard is in — over one shared set of sessions. A session is shown in at most one window.
// The workspace store keeps the key window's panes (the window with the keyboard) as its `split` / `activeSessionId`,
// so everything that acts on "the active session" acts in the window the user is in; the other windows' panes wait
// in `views` and trade places when another window takes the keyboard (focusWindow).
// Pure: the store applies these, workspace.json saves them (sanitizeWindows) and main opens the native windows.
import { hasPane, pane, paneIds, removePane, sanitizeSplit, sessionsIn, PICKER_PANE, type SplitNode } from './split-layout'
import type { ProjectId, SessionId } from './types'

export type WindowKey = string

/** The window that always exists (its panes are the top-level `split` / `activeSessionId` of workspace.json). */
export const MAIN_WINDOW: WindowKey = 'main'
export const MAX_WINDOWS = 8

/** Secondary windows are opened with `window.open('about:blank', WINDOW_FRAME_PREFIX + key)`; main allows only these. */
export const WINDOW_FRAME_PREFIX = 'wavi-window:'

const SECONDARY_KEY = /^w-[A-Za-z0-9]{1,32}$/

export const isSecondaryKey = (value: unknown): value is WindowKey => typeof value === 'string' && SECONDARY_KEY.test(value)

/** The secondary window a `window.open` frame name stands for, or null when it is not one. */
export function keyFromFrameName(name: string): WindowKey | null {
  if (!name.startsWith(WINDOW_FRAME_PREFIX)) return null
  const key = name.slice(WINDOW_FRAME_PREFIX.length)
  return isSecondaryKey(key) ? key : null
}

/** A window's panes: a split of two to four, or one session alone (null = nothing shown). */
export interface PaneView {
  split: SplitNode | null
  activeSessionId: SessionId | null
}

export const EMPTY_VIEW: PaneView = { split: null, activeSessionId: null }

/** Screen coordinates of a window's normal (not full-screen) frame. */
export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/** main → renderer: where a secondary window is now (its normal frame) and whether it is full screen. */
export interface WindowStateEvent {
  key: WindowKey
  bounds: WindowBounds
  fullScreen: boolean
}

export interface SecondaryWindow {
  key: WindowKey
  /** The project the window is for: its sidebar lists only this project. Null = every project. */
  projectId: ProjectId | null
  sidebarCollapsed: boolean
  bounds?: WindowBounds
  fullScreen?: boolean
}

export interface WindowsLayout {
  windows: readonly SecondaryWindow[]
  /** The window with the keyboard: its panes are the store's top-level ones. */
  keyWindow: WindowKey
  /** Every other window's panes, by key. */
  views: Readonly<Record<WindowKey, PaneView>>
}

export const SINGLE_WINDOW: WindowsLayout = { windows: [], keyWindow: MAIN_WINDOW, views: {} }

/** The layout and the key window's panes, changed together. */
export interface Windowed {
  layout: WindowsLayout
  top: PaneView
}

/** The sessions a window shows, left to right and top to bottom. */
export function shownIn(view: PaneView | undefined): SessionId[] {
  if (!view) return []
  return view.split ? sessionsIn(view.split) : view.activeSessionId ? [view.activeSessionId] : []
}

export const windowExists = (layout: WindowsLayout, key: WindowKey): boolean => key === MAIN_WINDOW || layout.windows.some((w) => w.key === key)

/** A window's panes. */
export function viewOf({ layout, top }: Windowed, key: WindowKey): PaneView {
  return key === layout.keyWindow ? top : (layout.views[key] ?? EMPTY_VIEW)
}

/** The window showing the session, or null. */
export function windowShowing(state: Windowed, id: SessionId): WindowKey | null {
  if (shownIn(state.top).includes(id)) return state.layout.keyWindow
  for (const [key, view] of Object.entries(state.layout.views)) if (shownIn(view).includes(id)) return key
  return null
}

/** Every session shown in some window. */
export function shownAnywhere({ layout, top }: Windowed): SessionId[] {
  return [...shownIn(top), ...Object.values(layout.views).flatMap(shownIn)]
}

/** The keyboard moves to another window: its panes come up to the top level, the previous key window's go to `views`. */
export function focusWindow(state: Windowed, key: WindowKey): Windowed {
  const { layout, top } = state
  if (key === layout.keyWindow || !windowExists(layout, key)) return state
  const views = { ...layout.views, [layout.keyWindow]: top }
  const next = views[key] ?? EMPTY_VIEW
  delete views[key]
  return { layout: { ...layout, keyWindow: key, views }, top: next }
}

/** A view without the session: its pane closes and the rest close up; the keyboard goes to the pane that took over. */
export function withoutSession(view: PaneView, id: SessionId): PaneView {
  if (!view.split) return view.activeSessionId === id ? EMPTY_VIEW : view
  if (!hasPane(view.split, id)) return view
  const { node, successor } = removePane(view.split, id)
  const left = node ? sessionsIn(node) : []
  const active =
    view.activeSessionId !== id && view.activeSessionId !== null && left.includes(view.activeSessionId)
      ? view.activeSessionId
      : successor !== null && left.includes(successor)
        ? successor
        : (left[0] ?? null)
  // Only the picker would be left beside nothing: no split.
  const split = node && paneIds(node).length >= 2 && left.length > 0 ? node : null
  return { split, activeSessionId: split || left.length > 0 ? active : null }
}

/** Takes the session out of every window but the key one (it is about to be shown there). */
export function takeFromOthers(layout: WindowsLayout, id: SessionId): WindowsLayout {
  let changed = false
  const views: Record<WindowKey, PaneView> = {}
  for (const [key, view] of Object.entries(layout.views)) {
    const next = withoutSession(view, id)
    if (next !== view) changed = true
    views[key] = next
  }
  return changed ? { ...layout, views } : layout
}

/**
 * Opens a secondary window that takes the keyboard, showing `sessionId` (moved from wherever it was shown) or nothing.
 * The window that had the keyboard keeps its other panes.
 */
export function openWindow(state: Windowed, window: SecondaryWindow, sessionId: SessionId | null): Windowed {
  if (windowExists(state.layout, window.key) || state.layout.windows.length >= MAX_WINDOWS) return state
  const fromTop = sessionId !== null ? withoutSession(state.top, sessionId) : state.top
  const others = sessionId !== null ? takeFromOthers(state.layout, sessionId) : state.layout
  const layout: WindowsLayout = {
    windows: [...others.windows, window],
    keyWindow: window.key,
    views: { ...others.views, [state.layout.keyWindow]: fromTop }
  }
  return { layout, top: sessionId !== null ? { split: null, activeSessionId: sessionId } : EMPTY_VIEW }
}

/** Closes a secondary window: its sessions keep running and are simply no longer shown. The main window takes the keyboard if it had it. */
export function closeWindow(state: Windowed, key: WindowKey): Windowed {
  if (key === MAIN_WINDOW || !state.layout.windows.some((w) => w.key === key)) return state
  const moved = state.layout.keyWindow === key ? focusWindow(state, MAIN_WINDOW) : state
  const views = { ...moved.layout.views }
  delete views[key]
  return { layout: { ...moved.layout, windows: moved.layout.windows.filter((w) => w.key !== key), views }, top: moved.top }
}

/** Changes one secondary window's record (bounds, sidebar). */
export function patchWindow(layout: WindowsLayout, key: WindowKey, patch: Partial<Omit<SecondaryWindow, 'key'>>): WindowsLayout {
  const index = layout.windows.findIndex((w) => w.key === key)
  const current = layout.windows[index]
  if (!current) return layout
  const next = { ...current, ...patch }
  if ((Object.keys(patch) as (keyof typeof patch)[]).every((k) => current[k] === next[k])) return layout
  const windows = layout.windows.slice()
  windows[index] = next
  return { ...layout, windows }
}

/**
 * Keeps every window in step after a workspace change: windows of removed projects close, panes of sessions that are
 * no longer listed (closed, archived) close in the windows that are not the key one (the store reconciles the key
 * window's own split), and a session never shows twice — a window that is not the key one keeps it, so a session the
 * key window picked by itself (closing its neighbour) gives way.
 */
export function reconcileWindows(state: Windowed, listed: (id: SessionId) => boolean, projectExists: (id: ProjectId) => boolean): Windowed {
  let current = state
  for (const w of state.layout.windows) if (w.projectId !== null && !projectExists(w.projectId)) current = closeWindow(current, w.key)
  const { layout } = current
  let views = layout.views
  for (const [key, view] of Object.entries(layout.views)) {
    let next = view
    for (const id of shownIn(view)) if (!listed(id)) next = withoutSession(next, id)
    if (next !== view) views = { ...views, [key]: next }
  }
  const elsewhere = new Set<SessionId>()
  // The main window's panes win over secondary ones, then earlier windows over later ones.
  const order = [MAIN_WINDOW, ...layout.windows.map((w) => w.key)].filter((key) => key !== layout.keyWindow)
  for (const key of order) {
    const view = views[key]
    if (!view) continue
    let next = view
    for (const id of shownIn(view)) {
      if (elsewhere.has(id)) next = withoutSession(next, id)
      else elsewhere.add(id)
    }
    if (next !== view) views = { ...views, [key]: next }
  }
  let top = current.top
  for (const id of shownIn(top)) if (elsewhere.has(id)) top = withoutSession(top, id)
  if (views === layout.views && top === current.top) return current
  return { layout: { ...layout, views }, top }
}

// ---------------------------------------------------------------------------------------------
// workspace.json
// ---------------------------------------------------------------------------------------------

/** A secondary window as workspace.json keeps it (the main window's panes are the file's top-level fields). */
export interface PersistedWindow {
  key: WindowKey
  projectId?: ProjectId
  activeSessionId?: SessionId
  split?: SplitNode
  sidebarCollapsed?: true
  bounds?: WindowBounds
  fullScreen?: true
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const coordinate = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100_000
const extent = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 100 && v <= 20_000

export function sanitizeBounds(raw: unknown): WindowBounds | null {
  if (!isRecord(raw)) return null
  const { x, y, width, height } = raw
  if (!coordinate(x) || !coordinate(y) || !extent(width) || !extent(height)) return null
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

export interface WindowSanitizeContext {
  /** Sessions the sidebar lists (only those can be shown). */
  listed: (id: SessionId) => boolean
  projectExists: (id: ProjectId) => boolean
  /** Sessions the main window shows: a secondary window cannot show them too. */
  taken: ReadonlySet<SessionId>
}

/** Secondary windows read from workspace.json: well-formed, unique keys, at most MAX_WINDOWS, each session shown once. */
export function sanitizeWindows(raw: unknown, context: WindowSanitizeContext): PersistedWindow[] {
  if (!Array.isArray(raw)) return []
  const taken = new Set(context.taken)
  const keys = new Set<WindowKey>()
  const windows: PersistedWindow[] = []
  for (const value of raw) {
    if (windows.length >= MAX_WINDOWS) break
    if (!isRecord(value) || !isSecondaryKey(value.key) || keys.has(value.key)) continue
    // A project window whose project is gone has nothing to be for.
    if (value.projectId !== undefined && (typeof value.projectId !== 'string' || !context.projectExists(value.projectId))) continue
    const keep = (id: SessionId): boolean => context.listed(id) && !taken.has(id)
    const split = sanitizeSplit(value.split, keep)
    const shown = sessionsIn(split)
    const wanted = typeof value.activeSessionId === 'string' ? value.activeSessionId : null
    const active = split ? (wanted !== null && shown.includes(wanted) ? wanted : (shown[0] ?? null)) : wanted !== null && keep(wanted) ? wanted : null
    for (const id of split ? shown : active ? [active] : []) taken.add(id)
    keys.add(value.key)
    const bounds = sanitizeBounds(value.bounds)
    windows.push({
      key: value.key,
      ...(typeof value.projectId === 'string' ? { projectId: value.projectId } : {}),
      ...(active ? { activeSessionId: active } : {}),
      ...(split ? { split } : {}),
      ...(value.sidebarCollapsed === true ? { sidebarCollapsed: true as const } : {}),
      ...(bounds ? { bounds } : {}),
      ...(value.fullScreen === true ? { fullScreen: true as const } : {})
    })
  }
  return windows
}

/** What workspace.json saves for a split: without the picker, and only from two panes up. */
function savedSplit(split: SplitNode | null): SplitNode | null {
  if (!split) return null
  const tree = hasPane(split, PICKER_PANE) ? removePane(split, PICKER_PANE).node : split
  return tree && paneIds(tree).length >= 2 ? tree : null
}

/** The main window's panes and the secondary windows, whichever window has the keyboard. */
export function serializeWindows(state: Windowed): { main: PaneView; windows: PersistedWindow[] } {
  const main = viewOf(state, MAIN_WINDOW)
  const windows = state.layout.windows.map((w): PersistedWindow => {
    const view = viewOf(state, w.key)
    const split = savedSplit(view.split)
    const shown = split ? sessionsIn(split) : []
    // A split cut down to one pane by dropping the picker saves that pane alone.
    const active = view.activeSessionId !== null && view.activeSessionId !== PICKER_PANE ? view.activeSessionId : (shown[0] ?? sessionsIn(view.split)[0] ?? null)
    return {
      key: w.key,
      ...(w.projectId !== null ? { projectId: w.projectId } : {}),
      ...(active ? { activeSessionId: active } : {}),
      ...(split ? { split } : {}),
      ...(w.sidebarCollapsed ? { sidebarCollapsed: true as const } : {}),
      ...(w.bounds ? { bounds: w.bounds } : {}),
      ...(w.fullScreen ? { fullScreen: true as const } : {})
    }
  })
  return { main, windows }
}

/** The layout a restart starts with: the main window has the keyboard. */
export function restoreWindows(windows: readonly PersistedWindow[] | undefined): WindowsLayout {
  if (!windows || windows.length === 0) return SINGLE_WINDOW
  const views: Record<WindowKey, PaneView> = {}
  for (const w of windows) views[w.key] = { split: w.split ?? null, activeSessionId: w.activeSessionId ?? null }
  return {
    windows: windows.map((w) => ({
      key: w.key,
      projectId: w.projectId ?? null,
      sidebarCollapsed: w.sidebarCollapsed === true,
      ...(w.bounds ? { bounds: w.bounds } : {}),
      ...(w.fullScreen ? { fullScreen: true } : {})
    })),
    keyWindow: MAIN_WINDOW,
    views
  }
}

/** A fresh secondary window key. */
export function newWindowKey(random: () => number = Math.random): WindowKey {
  return `w-${Math.floor(random() * 2 ** 48).toString(36)}`
}

/** The panes as a tree, a lone session included. */
export function viewRoot(view: PaneView): SplitNode | null {
  return view.split ?? (view.activeSessionId ? pane(view.activeSessionId) : null)
}
