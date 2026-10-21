// A small panel hung under the chip that opened it (Figma 17 TodoPopover 261:9986 / UsagePopover 269:10201):
// right-aligned to the chip, kept inside the window, closed by Esc, a click elsewhere, a resize or the window losing
// focus. `data-covers-page` takes the built-in browser's native page away while it is open (it draws above all DOM).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useWindowScope } from '../state/window-scope'
import styles from './SessionMeta.module.css'

const EDGE = 8
const GAP = 4

export function Popover({
  anchor,
  label,
  onClose,
  children,
  testId
}: {
  anchor: RefObject<HTMLElement | null>
  label: string
  onClose(): void
  children: ReactNode
  testId?: string
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
    const left = Math.max(EDGE, Math.min(box.right - width, win.innerWidth - EDGE - width))
    setPosition({ left, top: box.bottom + GAP })
  }, [anchor, win])

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

  return (
    <div
      ref={ref}
      className={styles.popover}
      role="dialog"
      aria-label={label}
      data-covers-page
      data-testid={testId}
      style={position ? { left: position.left, top: position.top } : { visibility: 'hidden' }}
    >
      {children}
    </div>
  )
}
