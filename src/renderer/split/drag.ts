// Dragging a session into the terminal area (PRD F20 · Figma 21D): a sidebar row, or a pane by the session name in
// its header. Pointer events, not HTML drag and drop, so it never meets the file drop of F19 (files from Finder
// arrive as a native drag). A press that does not move is a click as before; a drag swallows the click after it.
// The drag stays in the window it started in; released outside that window, the session moves to a new window of its
// own at that point (F20 · 多窗口).
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { SessionId } from '@shared/types'
import { MAIN_WINDOW } from '@shared/window-layout'
import { keyOfWindow, windowOfNode } from '../app-shell/windows-runtime'
import { useWorkspace } from '../state/workspace'
import { moveSessionToNewWindow } from './commands'
import { currentPanes, dropAt, localPoint, useSessionDrag, type SessionDrag } from './store'

/** How far the pointer moves before a press becomes a drag (as in the overview overlay). */
const DRAG_THRESHOLD = 4

/** Swallows the click the browser sends after a drag ends over the element it started on. */
function swallowNextClick(win: Window): void {
  const swallow = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
  }
  win.addEventListener('click', swallow, { capture: true, once: true })
  // A click only follows when the release lands on the element the press started on.
  setTimeout(() => win.removeEventListener('click', swallow, { capture: true }), 0)
}

/** Whether a point (window coordinates) is outside the window. */
const outsideOf = (win: Window, x: number, y: number): boolean => x < 0 || y < 0 || x >= win.innerWidth || y >= win.innerHeight

/** Starts watching a press on a session row or pane title; it becomes a drag once the pointer moves. */
export function pressSession(e: ReactPointerEvent<HTMLElement>, id: SessionId, from: SessionDrag['from']): void {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
  const startX = e.clientX
  const startY = e.clientY
  const pointerId = e.pointerId
  // The row (or title) that is being dragged steps back while it is (Figma 21D).
  const source = e.currentTarget
  const win = windowOfNode(source)
  const doc = win.document
  const key = keyOfWindow(win) ?? MAIN_WINDOW
  // The press already gave this window the keyboard (its focus event); make sure, the drop acts on the key window.
  useWorkspace.getState().focusWindow(key)
  // A pane dragged out keeps about its size as a window.
  const pane = from === 'pane' ? currentPanes().find((p) => p.id === id) : undefined
  let dragging = false
  const update = (x: number, y: number): void => {
    const local = localPoint(x, y, key)
    useSessionDrag.setState({ drag: { id, from, window: key, x, y, local, drop: dropAt(local, id, key), outside: outsideOf(win, x, y) } })
  }
  const move = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return
      dragging = true
      win.getSelection()?.removeAllRanges()
      doc.documentElement.dataset.sessionDrag = from
      source.dataset.dragged = 'true'
    }
    ev.preventDefault()
    update(ev.clientX, ev.clientY)
  }
  const finish = (drop: boolean, screen?: { screenX: number; screenY: number }): void => {
    win.removeEventListener('pointermove', move, true)
    win.removeEventListener('pointerup', up, true)
    win.removeEventListener('pointercancel', cancel, true)
    win.removeEventListener('keydown', escape, true)
    delete doc.documentElement.dataset.sessionDrag
    delete source.dataset.dragged
    const last = useSessionDrag.getState().drag
    const target = last?.drop ?? null
    useSessionDrag.setState({ drag: null })
    if (!dragging) return
    swallowNextClick(win)
    if (!drop) return
    if (last?.outside && screen) moveSessionToNewWindow(id, { ...screen, ...(pane ? { width: pane.width, height: pane.height } : {}) })
    else if (target && !('refused' in target)) useWorkspace.getState().dropSession(id, target.id, target.zone)
  }
  const up = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return
    if (dragging) update(ev.clientX, ev.clientY)
    finish(true, { screenX: ev.screenX, screenY: ev.screenY })
  }
  const cancel = (ev: PointerEvent): void => {
    if (ev.pointerId === pointerId) finish(false)
  }
  const escape = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape' || !dragging) return
    ev.preventDefault()
    ev.stopPropagation()
    finish(false)
  }
  win.addEventListener('pointermove', move, true)
  win.addEventListener('pointerup', up, true)
  win.addEventListener('pointercancel', cancel, true)
  win.addEventListener('keydown', escape, true)
}
