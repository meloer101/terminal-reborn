// The main area's split (PRD F20) at runtime: where the terminal area is on screen (measured by SplitArea, read by
// the keyboard commands and by drags) and the session being dragged into it. The split itself lives in the
// workspace store, which saves it.
import { create } from 'zustand'
import { dropTargetAt, measureSplit, pane, type Size, type SplitDrop, type SplitNode } from '@shared/split-layout'
import type { SessionId } from '@shared/types'
import { useWorkspace } from '../state/workspace'

interface SplitGeometry {
  /** The terminal area (every pane together), or null while it is not mounted. */
  element: HTMLElement | null
  area: Size
}

export const useSplitGeometry = create<SplitGeometry>(() => ({ element: null, area: { width: 0, height: 0 } }))

/** The panes as a tree, a lone session included; null on the welcome page. */
export function currentRoot(): SplitNode | null {
  const { split, activeSessionId, sessions } = useWorkspace.getState()
  if (split) return split
  return activeSessionId && sessions.some((s) => s.id === activeSessionId) ? pane(activeSessionId) : null
}

/** Every pane's place in the terminal area as it is laid out now. */
export function currentPanes(): ReturnType<typeof measureSplit>['panes'] {
  const root = currentRoot()
  const { area } = useSplitGeometry.getState()
  return root ? measureSplit(root, area.width, area.height).panes : []
}

export interface SessionDrag {
  id: SessionId
  /** A row from the sidebar, or a pane moved by its title. */
  from: 'sidebar' | 'pane'
  /** The pointer, in window coordinates. */
  x: number
  y: number
  /** The pointer in the terminal area, when it is over it. */
  local: { x: number; y: number } | null
  /** Where it would land in the terminal area, if the pointer is over it. */
  drop: SplitDrop | null
}

export const useSessionDrag = create<{ drag: SessionDrag | null }>(() => ({ drag: null }))

/** A window point in the terminal area, or null outside it (or while the overview shows). */
export function localPoint(clientX: number, clientY: number): { x: number; y: number } | null {
  const { element } = useSplitGeometry.getState()
  if (!element || useWorkspace.getState().mainView !== 'session') return null
  const box = element.getBoundingClientRect()
  const x = clientX - box.left
  const y = clientY - box.top
  return x < 0 || y < 0 || x >= box.width || y >= box.height ? null : { x, y }
}

/** The drop at a point in the terminal area for `dragged`. */
export function dropAt(point: { x: number; y: number } | null, dragged: SessionId): SplitDrop | null {
  const root = currentRoot()
  const { area } = useSplitGeometry.getState()
  if (!point || !root) return null
  return dropTargetAt(root, measureSplit(root, area.width, area.height).panes, point.x, point.y, dragged, area)
}
