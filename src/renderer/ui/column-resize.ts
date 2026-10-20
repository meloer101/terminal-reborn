// Dragging a column's edge to resize it (sidebar, right panel). The caller clamps and saves the width.
import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * Starts a drag on a vertical edge. `side` is where the edge sits on the column: 'right' grows as the pointer moves
 * right (sidebar), 'left' grows as it moves left (right panel).
 */
export function startColumnResize(
  e: ReactPointerEvent<HTMLElement>,
  side: 'left' | 'right',
  startWidth: number,
  setWidth: (width: number) => void
): void {
  if (e.button !== 0) return
  e.preventDefault()
  e.currentTarget.setPointerCapture(e.pointerId)
  const startX = e.clientX
  const sign = side === 'right' ? 1 : -1
  const move = (event: PointerEvent) => setWidth(startWidth + sign * (event.clientX - startX))
  // The release point counts too: Chromium can drop the last rAF-aligned move before pointerup.
  const up = (event: PointerEvent) => {
    move(event)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
  }
  // On the window, not the handle: Chromium sometimes drops the capture mid-drag (lostpointercapture with no
  // pointerup), and the rest of the drag then never reached the handle.
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}
