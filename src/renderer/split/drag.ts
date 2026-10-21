// Dragging a session into the terminal area (PRD F20 · Figma 21D): a sidebar row, or a pane by the session name in
// its header. Pointer events, not HTML drag and drop, so it never meets the file drop of F19 (files from Finder
// arrive as a native drag). A press that does not move is a click as before; a drag swallows the click after it.
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { SessionId } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { dropAt, localPoint, useSessionDrag, type SessionDrag } from './store'

/** How far the pointer moves before a press becomes a drag (as in the overview overlay). */
const DRAG_THRESHOLD = 4

/** Swallows the click the browser sends after a drag ends over the element it started on. */
function swallowNextClick(): void {
  const swallow = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
  }
  window.addEventListener('click', swallow, { capture: true, once: true })
  // A click only follows when the release lands on the element the press started on.
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
}

/** Starts watching a press on a session row or pane title; it becomes a drag once the pointer moves. */
export function pressSession(e: ReactPointerEvent<HTMLElement>, id: SessionId, from: SessionDrag['from']): void {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
  const startX = e.clientX
  const startY = e.clientY
  const pointerId = e.pointerId
  // The row (or title) that is being dragged steps back while it is (Figma 21D).
  const source = e.currentTarget
  let dragging = false
  const update = (x: number, y: number): void => {
    const local = localPoint(x, y)
    useSessionDrag.setState({ drag: { id, from, x, y, local, drop: dropAt(local, id) } })
  }
  const move = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return
      dragging = true
      window.getSelection()?.removeAllRanges()
      document.documentElement.dataset.sessionDrag = from
      source.dataset.dragged = 'true'
    }
    ev.preventDefault()
    update(ev.clientX, ev.clientY)
  }
  const finish = (drop: boolean): void => {
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', cancel, true)
    window.removeEventListener('keydown', key, true)
    delete document.documentElement.dataset.sessionDrag
    delete source.dataset.dragged
    const target = useSessionDrag.getState().drag?.drop ?? null
    useSessionDrag.setState({ drag: null })
    if (!dragging) return
    swallowNextClick()
    if (drop && target && !('refused' in target)) useWorkspace.getState().dropSession(id, target.id, target.zone)
  }
  const up = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return
    if (dragging) update(ev.clientX, ev.clientY)
    finish(true)
  }
  const cancel = (ev: PointerEvent): void => {
    if (ev.pointerId === pointerId) finish(false)
  }
  const key = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape' || !dragging) return
    ev.preventDefault()
    ev.stopPropagation()
    finish(false)
  }
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', cancel, true)
  window.addEventListener('keydown', key, true)
}
