// The sheet's dropdown (Figma 15C Popover · 分支): glass like the sheet, an optional search field, grouped items with an
// icon and right-aligned meta, and a hint line. Rendered into <body> under its anchor: a backdrop-filter inside the
// sheet would only see the sheet, not the window behind it.
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import styles from './NewSessionSheet.module.css'

export interface SheetMenuItem {
  value: string
  label: string
  icon: ReactNode
  meta?: string
}

export interface SheetMenuSection {
  title?: string
  items: SheetMenuItem[]
}

const GAP = 4
/** The menu is a little wider than its control (Figma: 446 under a 440 select). */
const OUTSET = 4
const MAX_HEIGHT = 360
const EDGE = 16

export function SheetMenu({
  anchor,
  label,
  sections,
  selected,
  search,
  hint,
  empty = '没有匹配的分支',
  onPick,
  onClose
}: {
  anchor: HTMLElement
  label: string
  /** Called with the current query; returns what to list. */
  sections: (query: string) => SheetMenuSection[]
  selected: string | null
  /** Placeholder of the search field; no field when absent. */
  search?: string
  hint?: string | null
  empty?: string
  onPick: (value: string) => void
  onClose: (refocus: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const listed = useMemo(() => sections(query), [sections, query])
  const flat = useMemo(() => listed.flatMap((section) => section.items), [listed])
  const [active, setActive] = useState(() => Math.max(0, flat.findIndex((item) => item.value === selected)))
  const [box, setBox] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()

  useLayoutEffect(() => {
    const place = (): void => {
      const rect = anchor.getBoundingClientRect()
      const top = rect.bottom + GAP
      setBox({ left: rect.left - OUTSET, top, width: rect.width + OUTSET * 2, maxHeight: Math.min(MAX_HEIGHT, window.innerHeight - top - EDGE) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor])

  // The menu renders once it is placed; then the keyboard goes to its search field (or list).
  const placed = box !== null
  useEffect(() => {
    if (placed) (field.current ?? list.current)?.focus({ preventScroll: true })
  }, [placed])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !anchor.contains(target)) onClose(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [anchor, onClose])

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(flat.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter' && !event.metaKey) {
      event.preventDefault()
      event.stopPropagation()
      const item = flat[active]
      if (item) onPick(item.value)
    } else if (event.key === 'Tab') {
      onClose(false)
    }
  }

  if (!box) return null
  let index = -1
  return createPortal(
    <div
      ref={menu}
      className={styles.menu}
      style={{ left: box.left, top: box.top, width: box.width, maxHeight: box.maxHeight }}
      onKeyDown={onKeyDown}
      data-new-session-menu
    >
      {search !== undefined && (
        <label className={styles.menuSearch}>
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input
            ref={field}
            type="text"
            value={query}
            placeholder={search}
            spellCheck={false}
            autoComplete="off"
            aria-label={search}
            aria-controls={listId}
            aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setActive(0)
            }}
          />
        </label>
      )}
      <div ref={list} id={listId} className={styles.menuList} role="listbox" aria-label={label} tabIndex={-1}>
        {listed.map((section, s) => (
          <Fragment key={section.title ?? s}>
            {section.title && section.items.length > 0 && (
              <div className={styles.menuGroup} role="presentation">
                {section.title}
              </div>
            )}
            {section.items.map((item) => {
              index++
              const at = index
              return (
                <div
                  key={item.value}
                  id={`${listId}-${at}`}
                  role="option"
                  aria-selected={item.value === selected}
                  data-index={at}
                  data-active={at === active}
                  className={styles.menuItem}
                  onPointerMove={() => setActive(at)}
                  onClick={() => onPick(item.value)}
                >
                  <span className={styles.menuIcon}>{item.icon}</span>
                  <span className={styles.menuLabel}>{item.label}</span>
                  {item.meta && <span className={styles.menuMeta}>{item.meta}</span>}
                </div>
              )
            })}
          </Fragment>
        ))}
        {flat.length === 0 && <div className={styles.menuEmpty}>{empty}</div>}
      </div>
      {hint && <p className={styles.menuHint}>{hint}</p>}
    </div>,
    document.body
  )
}
