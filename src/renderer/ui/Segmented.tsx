// Segmented control (Figma Segment 9:50 / 9:52 / 9:54): one row of options with a single highlight — the thumb —
// that slides and resizes to the chosen option with a spring (--motion-spring). Radio group by default, tab list
// for view switches. The thumb is measured from the chosen button, so labels of any width (and counts that change)
// work; the first placement and size changes are instant, only a change of choice moves it.
import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import styles from './Segmented.module.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  variant = 'fill',
  semantics = 'radio',
  arrows = 'select',
  className
}: {
  label: string
  value: T
  options: ReadonlyArray<SegmentedOption<T>>
  onChange: (value: T) => void
  /** fill: the group is a fill, the choice a lighter glass chip · outline: hairline group · plain: no group chrome. */
  variant?: 'fill' | 'outline' | 'plain'
  semantics?: 'radio' | 'tab'
  /** select: arrows choose (nothing is saved until later) · focus: arrows only move focus (the choice saves at once). */
  arrows?: 'select' | 'focus'
  className?: string
}) {
  const groupRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)
  const refs = useRef(new Map<T, HTMLButtonElement>())
  /** The geometry last written to the thumb; null while it is hidden (nothing chosen, or not laid out). */
  const placed = useRef<string | null>(null)
  const keys = options.map((o) => o.value).join('\n')

  useLayoutEffect(() => {
    const group = groupRef.current
    const thumb = thumbRef.current
    if (!group || !thumb) return
    const place = (slide: boolean): void => {
      const target = refs.current.get(value)
      if (!target || target.offsetWidth === 0) {
        thumb.hidden = true
        placed.current = null
        return
      }
      const geometry = `${target.offsetLeft} ${target.offsetTop} ${target.offsetWidth} ${target.offsetHeight}`
      // Unchanged (e.g. the observer's first call): touching the transition now would cut a running slide short.
      if (geometry === placed.current) return
      // Only a change of choice from a visible spot slides; a first placement or a size change just appears there.
      const jump = !slide || placed.current === null
      if (jump) thumb.style.transition = 'none'
      thumb.hidden = false
      thumb.style.width = `${target.offsetWidth}px`
      thumb.style.height = `${target.offsetHeight}px`
      thumb.style.transform = `translate(${target.offsetLeft}px, ${target.offsetTop}px)`
      if (jump) {
        void thumb.offsetWidth // commit the jump before the transition comes back
        thumb.style.transition = ''
      }
      placed.current = geometry
    }
    place(true)
    const observer = new ResizeObserver(() => place(false))
    observer.observe(group)
    for (const button of refs.current.values()) observer.observe(button)
    return () => observer.disconnect()
  }, [value, keys])

  const move = (event: KeyboardEvent, delta: number): void => {
    const enabled = options.filter((o) => !o.disabled)
    const focused = enabled.findIndex((o) => refs.current.get(o.value) === document.activeElement)
    const from = focused >= 0 ? focused : enabled.findIndex((o) => o.value === value)
    const next = enabled[(from + delta + enabled.length) % enabled.length]
    if (!next) return
    event.preventDefault()
    if (arrows === 'select') onChange(next.value)
    refs.current.get(next.value)?.focus()
  }

  const tab = semantics === 'tab'
  return (
    <div
      ref={groupRef}
      className={[styles.group, className].filter(Boolean).join(' ')}
      data-variant={variant}
      role={tab ? 'tablist' : 'radiogroup'}
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(event, 1)
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(event, -1)
      }}
    >
      <span className={styles.track} aria-hidden>
        <span ref={thumbRef} className={styles.thumb} hidden />
      </span>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) refs.current.set(option.value, node)
              else refs.current.delete(option.value)
            }}
            type="button"
            role={tab ? 'tab' : 'radio'}
            aria-checked={tab ? undefined : selected}
            aria-selected={tab ? selected : undefined}
            data-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            className={styles.option}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
