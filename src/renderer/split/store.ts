// The main area's split (PRD F20) at runtime: where each window's terminal area is on screen (measured by SplitArea,
// read by the keyboard commands and by drags) and the session being dragged into one. The splits themselves live in
// the workspace store, which saves them. Every window has its own terminal area (F20 · 多窗口).
import { create } from 'zustand'
import { dropTargetAt, measureSplit, type Size, type SplitDrop, type SplitNode } from '@shared/split-layout'
import type { SessionId } from '@shared/types'
import { MAIN_WINDOW, viewRoot, type WindowKey } from '@shared/window-layout'
import { paneViewOf, useWorkspace } from '../state/workspace'

interface SplitGeometry {
  /** The terminal area (every pane together), or null while it is not mounted. */
  element: HTMLElement | null
  area: Size
}

const NO_GEOMETRY: SplitGeometry = { element: null, area: { width: 0, height: 0 } }

export const useSplitGeometry = create<{ windows: Readonly<Record<WindowKey, SplitGeometry>> }>(() => ({ windows: {} }))

export function setSplitGeometry(key: WindowKey, geometry: SplitGeometry | null): void {
  useSplitGeometry.setState((s) => {
    const windows = { ...s.windows }
    if (geometry) windows[key] = geometry
    else delete windows[key]
    return { windows }
  })
}

/** A window's terminal area; the key window's by default. */
export function geometryOf(key: WindowKey = useWorkspace.getState().keyWindow): SplitGeometry {
  return useSplitGeometry.getState().windows[key] ?? NO_GEOMETRY
}

/** Whether the window shows its panes (the main window may show the overview instead). */
export function showsPanes(key: WindowKey): boolean {
  return key !== MAIN_WINDOW || useWorkspace.getState().mainView === 'session'
}

/** A window's panes as a tree, a lone session included (the key window's by default); null when it shows none. */
export function currentRoot(key: WindowKey = useWorkspace.getState().keyWindow): SplitNode | null {
  const state = useWorkspace.getState()
  const view = paneViewOf(state, key)
  if (view.split) return view.split
  return view.activeSessionId && state.sessions.some((s) => s.id === view.activeSessionId) ? viewRoot(view) : null
}

/** Every pane's place in the key window's terminal area as it is laid out now. */
export function currentPanes(): ReturnType<typeof measureSplit>['panes'] {
  const root = currentRoot()
  const { area } = geometryOf()
  return root ? measureSplit(root, area.width, area.height).panes : []
}

export interface SessionDrag {
  id: SessionId
  /** A row from the sidebar, or a pane moved by its title. */
  from: 'sidebar' | 'pane'
  /** The window the drag happens in. */
  window: WindowKey
  /** The pointer, in that window's coordinates. */
  x: number
  y: number
  /** The pointer in the terminal area, when it is over it. */
  local: { x: number; y: number } | null
  /** Where it would land in the terminal area, if the pointer is over it. */
  drop: SplitDrop | null
  /** The pointer left the window: releasing opens the session in a new window (F20 · 多窗口). */
  outside: boolean
}

export const useSessionDrag = create<{ drag: SessionDrag | null }>(() => ({ drag: null }))

/** A point of the window in its terminal area, or null outside it (or while the overview shows). */
export function localPoint(clientX: number, clientY: number, key: WindowKey = useWorkspace.getState().keyWindow): { x: number; y: number } | null {
  const { element } = geometryOf(key)
  if (!element || !showsPanes(key)) return null
  const box = element.getBoundingClientRect()
  const x = clientX - box.left
  const y = clientY - box.top
  return x < 0 || y < 0 || x >= box.width || y >= box.height ? null : { x, y }
}

/** The drop at a point in the window's terminal area for `dragged`. */
export function dropAt(point: { x: number; y: number } | null, dragged: SessionId, key: WindowKey = useWorkspace.getState().keyWindow): SplitDrop | null {
  const root = currentRoot(key)
  const { area } = geometryOf(key)
  if (!point || !root) return null
  return dropTargetAt(root, measureSplit(root, area.width, area.height).panes, point.x, point.y, dragged, area)
}
