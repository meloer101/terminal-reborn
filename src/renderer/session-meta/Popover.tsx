// A small panel hung under the chip that opened it (Figma 17 TodoPopover 261:9986 / UsagePopover 269:10201):
// right-aligned to the chip, kept inside the window, closed by Esc, a click elsewhere, a resize or the window losing
// focus. `data-covers-page` takes the built-in browser's native page away while it is open (it draws above all DOM).
// It is rendered into the window's body: a header sits in its pane's stacking context and the right panel may be
// mid-slide (transform / filter), either of which would put a fixed popover under a card or in the wrong place.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useWindowScope } from '../state/window-scope'
import styles from './SessionMeta.module.css'

const EDGE = 8
const GAP = 4

export function Popover({
  anchor,
  label,
  onClose,
  children,
  testId,
  placement = 'below',
  className
}: {
  anchor: RefObject<HTMLElement | null>
  label: string
  onClose(): void
  children: ReactNode
  testId?: string
  /** `above`: over the anchor, left edges aligned — for an anchor near the window's foot (the sidebar's 更新, Figma 36G). */
  placement?: 'below' | 'above'
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  // The window the chip is in (F20 · 多窗口).
  const { win } = useWindowScope()
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const panel = ref.current
    const box = anchor.current?.getBoundingClientRect()
    if (!panel || !box) return
    const width = panel.offsetWidth
    const wanted = placement === 'above' ? box.left : box.right - width
    const left = Math.max(EDGE, Math.min(wanted, win.innerWidth - EDGE - width))
    const top = placement === 'above' ? Math.max(EDGE, box.top - GAP - panel.offsetHeight) : box.bottom + GAP
    setPosition({ left, top })
  }, [anchor, win, placement])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      // The chip toggles itself; anything else outside closes.
      if (target && (ref.current?.contains(target) || anchor.current?.contains(target))) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    win.document.addEventListener('pointerdown', onPointerDown, true)
    win.addEventListener('keydown', onKeyDown, true)
    win.addEventListener('resize', onClose)
    win.addEventListener('blur', onClose)
    return () => {
      win.document.removeEventListener('pointerdown', onPointerDown, true)
      win.removeEventListener('keydown', onKeyDown, true)
      win.removeEventListener('resize', onClose)
      win.removeEventListener('blur', onClose)
    }
  }, [anchor, onClose, win])

  return createPortal(
    <div
      ref={ref}
      className={className ? `${styles.popover} ${className}` : styles.popover}
      role="dialog"
      aria-label={label}
      data-covers-page
      data-testid={testId}
      style={position ? { left: position.left, top: position.top } : { visibility: 'hidden' }}
    >
      {children}
    </div>,
    win.document.body
  )
}
