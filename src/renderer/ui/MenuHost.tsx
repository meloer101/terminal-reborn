import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { anchorOf, formatAccelerator, isActionable, originToward, placeMenu, stepIndex, type MenuEntry, type Placement } from './menu-model'
import { closeMenu, useMenu } from './menu'
import { useWindowScope } from '../state/window-scope'
import styles from './MenuHost.module.css'

/**
 * The open context / dropdown menu (ui/menu.ts). No Figma frame: built from the settings select's list
 * (raised surface, hairline border, --radius-md, 28px rows) so menus read as part of the app, in both themes.
 * Focus sits on the panel under the pointer (or the deepest one opened from the keyboard); rows are
 * aria-activedescendant options of it.
 */
export function MenuHost() {
  const menu = useMenu((s) => s.menu)
  const { win } = useWindowScope()
  // Only the window the menu opens in draws it (F20 · 多窗口).
  return menu && menu.doc === win.document ? <MenuLayer key={menu.serial} entries={menu.entries} placement={menu.placement} win={win} /> : null
}

function MenuLayer({ entries, placement, win }: { entries: MenuEntry[]; placement: Placement; win: Window }) {
  useEffect(() => {
    const document = win.document
    const window = win
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target?.closest?.('[data-menu-panel]')) closeMenu(null, target ?? undefined)
    }
    const onWheel = (event: WheelEvent) => {
      if (!(event.target as Element | null)?.closest?.('[data-menu-panel]')) closeMenu(null)
    }
    const dismiss = () => closeMenu(null)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('wheel', onWheel, { capture: true, passive: true })
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [win])
  return <MenuPanel entries={entries} placement={placement} label="菜单" takeFocus />
}

interface PanelProps {
  entries: MenuEntry[]
  placement: Placement
  label: string
  /** Opened from the keyboard (or the root menu): focus the panel, and highlight the first row of a submenu. */
  takeFocus: boolean
  firstActive?: boolean
  /** Submenus only: ← / Esc hands control back to the parent row. */
  onBack?(): void
  /** The first this many entries scroll in a list of fixed height; the rest stay under it (a submenu's footer). */
  scrollCount?: number
}

interface Submenu {
  index: number
  placement: Placement
  fromKeyboard: boolean
}

function MenuPanel({ entries, placement, label, takeFocus, firstActive = false, onBack, scrollCount }: PanelProps) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  /** The arrow keys moved the highlight: bring that row into the scrolling list's view (the pointer only hovers seen rows). */
  const movedByKey = useRef(false)
  const [position, setPosition] = useState<{ left: number; top: number; origin: string } | null>(null)
  const [active, setActive] = useState(() => (firstActive ? stepIndex(entries, -1, 1) : -1))
  const [submenu, setSubmenu] = useState<Submenu | null>(null)

  useLayoutEffect(() => {
    const el = panel.current
    if (!el) return
    const size = { width: el.offsetWidth, height: el.offsetHeight }
    const view = el.ownerDocument.defaultView ?? window
    const at = placeMenu(size, placement, { width: view.innerWidth, height: view.innerHeight })
    setPosition({ ...at, origin: originToward(anchorOf(placement), at, size) })
  }, [placement])

  // Only once placed: a visibility:hidden panel cannot take focus.
  const placed = position !== null
  useLayoutEffect(() => {
    if (placed && takeFocus) panel.current?.focus({ preventScroll: true })
  }, [placed, takeFocus])

  const openSubmenu = useCallback(
    (index: number, fromKeyboard: boolean) => {
      const row = panel.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      const box = panel.current?.getBoundingClientRect()
      if (!row || !box) return
      const r = row.getBoundingClientRect()
      setSubmenu({ index, fromKeyboard, placement: { kind: 'beside', box: { left: box.left, right: box.right, top: r.top, bottom: r.bottom } } })
    },
    []
  )

  useLayoutEffect(() => {
    if (!movedByKey.current) return
    movedByKey.current = false
    panel.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const closeSubmenu = useCallback(() => {
    setSubmenu(null)
    panel.current?.focus({ preventScroll: true })
  }, [])

  const activate = (index: number, fromKeyboard: boolean) => {
    const entry = entries[index]
    if (!entry || !isActionable(entry)) return
    if (entry.type === 'submenu') openSubmenu(index, fromKeyboard)
    else if (entry.type === 'item') closeMenu(entry.id)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key
    const handled = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' ', 'Escape', 'Tab'].includes(key)
    if (!handled) return
    event.preventDefault()
    event.stopPropagation()
    movedByKey.current = ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)
    if (key === 'ArrowDown') setActive((i) => stepIndex(entries, i, 1))
    else if (key === 'ArrowUp') setActive((i) => stepIndex(entries, i < 0 ? entries.length : i, -1))
    else if (key === 'Home') setActive(stepIndex(entries, -1, 1))
    else if (key === 'End') setActive(stepIndex(entries, entries.length, -1))
    else if (key === 'Enter' || key === ' ') activate(active, true)
    else if (key === 'ArrowRight') {
      if (entries[active]?.type === 'submenu') openSubmenu(active, true)
    } else if (key === 'ArrowLeft') onBack?.()
    else if (key === 'Escape') (onBack ?? (() => closeMenu(null)))()
    else if (key === 'Tab') closeMenu(null)
  }

  const onRowPointerMove = (index: number) => {
    if (panel.current?.ownerDocument.activeElement !== panel.current) panel.current?.focus({ preventScroll: true })
    const entry = entries[index]!
    if (!isActionable(entry)) return
    setActive(index)
    if (entry.type === 'submenu') {
      if (submenu?.index !== index) openSubmenu(index, false)
    } else if (submenu) setSubmenu(null)
  }

  const row = (entry: MenuEntry, index: number) => {
    if (entry.type === 'header') {
      return (
        <div key={index} className={styles.header} role="presentation">
          {entry.label}
        </div>
      )
    }
    if (entry.type === 'separator') return <div key={index} className={styles.separator} role="separator" />
    return (
      <div
        key={index}
        id={`${id}-${index}`}
        className={styles.item}
        role={entry.type === 'item' && entry.checked !== undefined ? 'menuitemradio' : 'menuitem'}
        aria-checked={entry.type === 'item' && entry.checked !== undefined ? entry.checked : undefined}
        data-index={index}
        data-active={index === active}
        data-muted={entry.type === 'item' && entry.muted ? true : undefined}
        aria-label={entry.type === 'item' && entry.muted ? `${entry.label}，没装` : undefined}
        aria-disabled={entry.type === 'item' && entry.enabled === false ? true : undefined}
        aria-haspopup={entry.type === 'submenu' ? 'menu' : undefined}
        aria-expanded={entry.type === 'submenu' ? submenu?.index === index : undefined}
        aria-keyshortcuts={entry.type === 'item' && entry.accelerator ? ariaShortcut(entry.accelerator) : undefined}
        onPointerMove={() => onRowPointerMove(index)}
        onClick={() => activate(index, false)}
      >
        {entry.type === 'item' && entry.icon && (
          <span className={styles.icon} aria-hidden>
            <entry.icon size={16} strokeWidth={1.75} />
          </span>
        )}
        <span className={styles.label}>{entry.label}</span>
        {entry.type === 'item' && entry.accelerator && (
          <span className={styles.shortcut} aria-hidden>
            {formatAccelerator(entry.accelerator)}
          </span>
        )}
        {entry.type === 'item' && entry.checked && (
          <span className={styles.check} aria-hidden>
            <Check size={16} strokeWidth={1.75} />
          </span>
        )}
        {entry.type === 'submenu' && (
          <span className={styles.chevron} aria-hidden>
            <ChevronRight size={16} strokeWidth={1.75} />
          </span>
        )}
      </div>
    )
  }

  const style: CSSProperties = position
    ? { left: position.left, top: position.top, transformOrigin: position.origin }
    : { left: 0, top: 0, visibility: 'hidden' }
  const sub = submenu ? entries[submenu.index] : undefined

  return (
    <>
      <div
        ref={panel}
        className={styles.panel}
        style={style}
        role="menu"
        aria-label={label}
        aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        tabIndex={-1}
        data-menu-panel=""
        data-placement={placement.kind}
        onKeyDown={onKeyDown}
        onPointerLeave={() => {
          if (!submenu) setActive(-1)
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {scrollCount === undefined ? (
          entries.map(row)
        ) : (
          <>
            <div className={styles.list}>{entries.slice(0, scrollCount).map(row)}</div>
            {entries.slice(scrollCount).map((entry, i) => row(entry, scrollCount + i))}
          </>
        )}
      </div>
      {submenu && sub?.type === 'submenu' && (
        <MenuPanel
          key={submenu.index}
          entries={sub.footer ? [...sub.items, ...sub.footer] : sub.items}
          scrollCount={sub.footer ? sub.items.length : undefined}
          placement={submenu.placement}
          label={sub.label}
          takeFocus={submenu.fromKeyboard}
          firstActive={submenu.fromKeyboard}
          onBack={closeSubmenu}
        />
      )}
    </>
  )
}

/** 'CmdOrCtrl+W' → 'Meta+W' (aria-keyshortcuts syntax). */
const ariaShortcut = (accelerator: string) =>
  accelerator
    .split('+')
    .map((part) => (/^(cmdorctrl|commandorcontrol|cmd|command)$/i.test(part) ? 'Meta' : /^option$/i.test(part) ? 'Alt' : part))
    .join('+')
