// Figma 37: the glass block under the selected session row. It travels between rows on two springs
// (selection-drop.ts); style is written straight to the element each frame, React only says which row is selected.
// Snaps instead of travelling on first show, on layout changes and with 减少动态效果. No backdrop filter: the window is
// transparent, so a backdrop filter reads empty pixels and darkens the block (PRD §5 v1.74; measured again here).
import { useEffect, useLayoutEffect, useRef } from 'react'
import { aim, settled, shape, spring, step, type Spring } from './selection-drop'
import styles from './SelectionDrop.module.css'

/** Lives inside the sidebar's scrolling session list (its parent element), which it measures rows against. */
export function SelectionDrop({ selectedId }: { selectedId: string | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const motion = useRef<{ upper: Spring; lower: Spring; raf: number; last: number; shownId: string | null } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    const container = el?.parentElement
    if (!el || !container) return
    const row = selectedId === null ? null : container.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(selectedId)}"]`)
    if (!row) {
      el.dataset.visible = 'false'
      if (motion.current) motion.current.shownId = null
      return
    }
    const top = row.offsetTop
    const bottom = top + row.offsetHeight
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const m = motion.current
    const draw = (): void => {
      const s = motion.current
      if (!s) return
      const f = shape(s.upper, s.lower)
      el.style.transform = `translateY(${f.top}px)`
      el.style.height = `${f.height}px`
      el.style.left = `${f.inset}px`
      el.style.right = `${f.inset}px`
      el.style.borderRadius = `${f.radius}px`
    }
    el.dataset.visible = 'true'
    // First show, after nothing was selected, or with 减少动态效果: no travel.
    if (m === null || m.shownId === null || reduce) {
      if (m) cancelAnimationFrame(m.raf)
      motion.current = { upper: spring(top), lower: spring(bottom), raf: 0, last: 0, shownId: selectedId }
      draw()
      return
    }
    if (m.shownId === selectedId) {
      // The sidebar redraws on every agent event: mid-flight, only follow the row; at rest, snap if it moved.
      if (m.raf) aim(m.upper, m.lower, top, bottom)
      else if (m.upper.target !== top || m.lower.target !== bottom) {
        m.upper = spring(top)
        m.lower = spring(bottom)
        draw()
      }
      return
    }
    m.shownId = selectedId
    aim(m.upper, m.lower, top, bottom)
    if (m.raf) return
    m.last = performance.now()
    const tick = (now: number): void => {
      const s = motion.current
      if (!s) return
      const dt = Math.min(0.032, (now - s.last) / 1000)
      s.last = now
      for (let i = 0; i < 4; i++) {
        step(s.upper, dt / 4)
        step(s.lower, dt / 4)
      }
      if (settled(s.upper, s.lower)) {
        s.upper = spring(s.upper.target)
        s.lower = spring(s.lower.target)
        s.raf = 0
        draw()
        return
      }
      draw()
      s.raf = requestAnimationFrame(tick)
    }
    m.raf = requestAnimationFrame(tick)
  })

  // The list reflows when the sidebar is resized: keep the block on its row.
  useEffect(() => {
    const el = ref.current
    const container = el?.parentElement
    if (!container || !el) return
    const observer = new ResizeObserver(() => {
      const m = motion.current
      if (!m || m.raf || m.shownId === null) return
      const row = container.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(m.shownId)}"]`)
      if (!row) return
      m.upper = spring(row.offsetTop)
      m.lower = spring(row.offsetTop + row.offsetHeight)
      el.style.transform = `translateY(${row.offsetTop}px)`
      el.style.height = `${row.offsetHeight}px`
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      if (motion.current) cancelAnimationFrame(motion.current.raf)
    }
  }, [])

  return <div ref={ref} className={styles.drop} data-visible="false" data-testid="selection-drop" aria-hidden />
}
