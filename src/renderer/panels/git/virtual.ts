// Windowed rendering for the Git view's long lists (commit rows, diff lines): which items intersect the viewport.
// Pure; item heights are known up front, so no measuring.
import { useLayoutEffect, useState, type RefObject } from 'react'

/** Start offsets of each item plus the total height: `offsets[i]` = top of item i, `offsets[n]` = total. */
export function offsetsOf(heights: readonly number[]): number[] {
  const offsets = new Array<number>(heights.length + 1)
  offsets[0] = 0
  for (let i = 0; i < heights.length; i++) offsets[i + 1] = offsets[i]! + heights[i]!
  return offsets
}

/** Index of the item at `y` (clamped to the list). */
export function indexAt(offsets: readonly number[], y: number): number {
  const count = offsets.length - 1
  if (count <= 0) return 0
  let low = 0
  let high = count - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (offsets[mid]! <= y) low = mid
    else high = mid - 1
  }
  return low
}

/** Items to render for a viewport: [first, last), with `overscan` extra items on each side. */
export function visibleRange(offsets: readonly number[], top: number, height: number, overscan: number): [number, number] {
  const count = offsets.length - 1
  if (count <= 0) return [0, 0]
  const first = Math.max(0, indexAt(offsets, top) - overscan)
  const last = Math.min(count, indexAt(offsets, top + Math.max(0, height - 1)) + 1 + overscan)
  return [first, last]
}

/** The scroller's scroll position and height, kept current on scroll and resize. */
export function useViewport(scroller: RefObject<HTMLElement | null>, ready: boolean): { top: number; height: number } {
  const [viewport, setViewport] = useState({ top: 0, height: 0 })
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    const measure = () => setViewport({ top: element.scrollTop, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    element.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', measure)
    }
  }, [scroller, ready])
  return viewport
}
