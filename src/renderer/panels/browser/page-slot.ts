// The page itself is a native view main lays over this element's rectangle: it draws above all DOM. So the slot
// reports its rectangle on every layout change and takes the page away whenever it cannot be shown — the slot is
// gone (pane closed, overview), too small (narrow window), or a menu / modal dialog is open (then a snapshot of
// the page stands in, so the scrim still has something to dim).
import { useEffect, useState, type RefObject } from 'react'

/** Below this the page is not worth showing. */
const MIN_SIDE = 80
/** DOM that must stay above the page (popovers opt in with data-covers-page, e.g. the session header's todo / usage). */
const COVER_SELECTOR = '[role="menu"], [role="dialog"][aria-modal="true"], [data-covers-page]'

/** Whether something that must draw above the page is open. */
function covered(): boolean {
  return document.querySelector(COVER_SELECTOR) !== null
}

/**
 * Keeps main's page for `worktree` over `ref` while `active`; returns a snapshot to show while it is covered.
 * `layoutKey` changes when the slot may move without resizing (e.g. mobile ↔ desktop).
 */
export function usePageSlot(ref: RefObject<HTMLElement | null>, worktree: string, active: boolean, layoutKey: string): string | null {
  const [snapshot, setSnapshot] = useState<string | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!active || !element) {
      window.tr.browser.hide()
      return
    }
    let frame = 0
    let disposed = false
    let isCovered = false
    let last = ''

    const sync = () => {
      frame = 0
      if (disposed) return
      if (covered()) {
        if (isCovered) return
        isCovered = true
        last = ''
        void window.tr.browser.cover().then((image) => {
          if (!disposed && isCovered) setSnapshot(image)
        })
        return
      }
      isCovered = false
      const rect = element.getBoundingClientRect()
      if (rect.width < MIN_SIDE || rect.height < MIN_SIDE) {
        if (last !== 'hidden') window.tr.browser.hide()
        last = 'hidden'
        return
      }
      const bounds = { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
      const key = JSON.stringify(bounds)
      if (key === last) return
      last = key
      window.tr.browser.show(worktree, bounds)
      setSnapshot(null)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync)
    }

    sync()
    const resize = new ResizeObserver(schedule)
    resize.observe(element)
    resize.observe(document.documentElement)
    // Menus and dialogs mount anywhere in the document.
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    return () => {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', schedule)
      window.tr.browser.hide()
      setSnapshot(null)
    }
  }, [ref, worktree, active, layoutKey])

  return active ? snapshot : null
}
