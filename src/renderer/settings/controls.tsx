// Form atoms for the settings window — Figma components Select (12:126), Slider (12:137),
// Toggle (12:136) and ThemeSwatch (12:162); Segment (9:54) is the shared ui/Segmented.
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import styles from './controls.module.css'

const COMMIT_DELAY_MS = 50

/** Shows a draft while a continuous control is being dragged and commits it ~50 ms after the last change. */
function useDraft<T>(value: T, onCommit: (value: T) => void): { shown: T; push: (next: T) => void } {
  const [draft, setDraft] = useState<T | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef(onCommit)
  useEffect(() => {
    latest.current = onCommit
  })
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const push = useCallback((next: T) => {
    setDraft(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      latest.current(next)
      setDraft(null)
    }, COMMIT_DELAY_MS)
  }, [])
  return { shown: draft ?? value, push }
}

/* ---------- layout ---------- */

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-label={title}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  )
}

export function Row({ label, children, id }: { label: string; children: ReactNode; id?: string }) {
  return (
    <div className={styles.row} role="group" aria-label={label} data-row={id}>
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.rowControl}>{children}</div>
    </div>
  )
}

/* ---------- Toggle ---------- */

export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={styles.toggle} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className={styles.toggleKnob} />
    </button>
  )
}

/* ---------- Slider ---------- */

export function Slider({
  value,
  min,
  max,
  step,
  onCommit,
  format,
  label
}: {
  value: number
  min: number
  max: number
  step: number
  onCommit: (value: number) => void
  format: (value: number) => string
  label: string
}) {
  const { shown, push } = useDraft(value, onCommit)
  const pct = ((shown - min) / (max - min)) * 100
  return (
    <div className={styles.slider}>
      <input
        type="range"
        className={styles.range}
        min={min}
        max={max}
        step={step}
        value={shown}
        aria-label={label}
        aria-valuetext={format(shown)}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(event) => push(Number(event.currentTarget.value))}
      />
      <output className={styles.sliderValue}>{format(shown)}</output>
    </div>
  )
}

/* ---------- ThemeSwatch ---------- */

export type SwatchKind = 'dark' | 'light' | 'system'

export function ThemeSwatches<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string; kind: SwatchKind }>
  onChange: (value: T) => void
  label: string
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>())
  // Arrows move the focus only; Space / Enter choose. Every choice is saved at once, so an arrow press meant to
  // scroll the page right after clicking an option must not switch it (B17: the theme turned dark that way).
  const move = (event: KeyboardEvent, delta: number): void => {
    const focused = options.findIndex((option) => refs.current.get(option.value) === document.activeElement)
    const from = focused >= 0 ? focused : options.findIndex((option) => option.value === value)
    const next = options[(from + delta + options.length) % options.length]
    if (!next) return
    event.preventDefault()
    refs.current.get(next.value)?.focus()
  }
  return (
    <div
      className={styles.swatches}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(event, 1)
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(event, -1)
      }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          ref={(node) => {
            if (node) refs.current.set(option.value, node)
            else refs.current.delete(option.value)
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          className={styles.swatch}
          data-selected={option.value === value}
          onClick={() => onChange(option.value)}
        >
          <span className={styles.swatchPreview} data-kind={option.kind}>
            <span className={styles.swatchSidebar} />
            <span className={styles.swatchLine} style={{ left: 32, top: 12, width: 36, background: 'var(--swatch-accent)' }} />
            <span className={styles.swatchLine} style={{ left: 32, top: 22, width: 48, background: 'var(--swatch-blue)' }} />
            <span className={styles.swatchLine} style={{ left: 32, top: 32, width: 28, background: 'var(--swatch-green)' }} />
          </span>
          <span className={styles.swatchName}>{option.label}</span>
        </button>
      ))}
    </div>
  )
}

/* ---------- Select (listbox popover) ---------- */

export interface SelectOption {
  value: string
  label: string
  /** Renders the label in this style (font menus show each family in its own face). */
  labelStyle?: CSSProperties
  /** Right-aligned secondary text, e.g. a font sample. */
  sample?: string
  sampleStyle?: CSSProperties
  /** Options with a group get a heading where the group changes; callers pass them already in group order. */
  group?: string
}

export function Select({
  value,
  options,
  onChange,
  label,
  allowCustom = false,
  placeholder = '搜索或输入名称',
  emptyText = '没有匹配项',
  displayLabel
}: {
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  label: string
  /** Adds a search field; Enter on text that matches no option selects the typed text itself. */
  allowCustom?: boolean
  placeholder?: string
  emptyText?: string
  /** Style/label for the closed button when `value` is not an option. */
  displayLabel?: SelectOption
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()

  const current = options.find((option) => option.value === value) ?? displayLabel ?? { value, label: value }
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle === '' ? options : options.filter((option) => option.label.toLowerCase().includes(needle))
  }, [options, query])

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) button.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // On open: focus the field (or list) and scroll the selected option into view.
  useEffect(() => {
    if (!open) return
    ;(search.current ?? list.current)?.focus({ preventScroll: true })
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' })
  }, [open])

  useEffect(() => {
    if (!open) return
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const openMenu = (): void => {
    setQuery('')
    const index = options.findIndex((option) => option.value === value)
    setActive(Math.max(0, index))
    setOpen(true)
  }

  const choose = (next: string): void => {
    onChange(next)
    close(true)
  }

  const onMenuKeyDown = (event: KeyboardEvent): void => {
    // Keys of an input method composing in the search field are its own (Enter confirms, Esc cancels).
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(filtered.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
    } else if (event.key === 'Home' && !allowCustom) {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End' && !allowCustom) {
      event.preventDefault()
      setActive(filtered.length - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const typed = query.trim()
      const exact = filtered.find((option) => option.label.toLowerCase() === typed.toLowerCase())
      const picked = exact ?? filtered[active]
      if (picked) choose(picked.value)
      else if (typed !== '' && allowCustom) choose(typed)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  const typed = query.trim()
  const canUseTyped = allowCustom && typed !== '' && !options.some((option) => option.label.toLowerCase() === typed.toLowerCase())

  return (
    <div className={styles.selectRoot} ref={root}>
      <button
        ref={button}
        type="button"
        className={styles.select}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            openMenu()
          }
        }}
      >
        <span className={styles.selectValue} style={current.labelStyle}>
          {current.label}
        </span>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <div className={styles.menu} onKeyDown={onMenuKeyDown}>
          {allowCustom && (
            <input
              ref={search}
              className={styles.menuSearch}
              type="text"
              value={query}
              placeholder={placeholder}
              spellCheck={false}
              autoComplete="off"
              aria-label={placeholder}
              aria-controls={listId}
              aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
              onChange={(event) => {
                setQuery(event.currentTarget.value)
                setActive(0)
              }}
            />
          )}
          <div ref={list} id={listId} role="listbox" aria-label={label} tabIndex={-1} className={styles.menuList}>
            {filtered.map((option, index) => (
              <Fragment key={option.value}>
                {option.group && option.group !== filtered[index - 1]?.group && (
                  <div className={styles.optionGroup} role="presentation">
                    {option.group}
                  </div>
                )}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  data-index={index}
                  data-active={index === active}
                  className={styles.option}
                  onPointerMove={() => setActive(index)}
                  onClick={() => choose(option.value)}
                >
                  <span className={styles.optionCheck}>{option.value === value && <Check size={16} strokeWidth={1.75} aria-hidden />}</span>
                  <span className={styles.optionLabel} style={option.labelStyle}>
                    {option.label}
                  </span>
                  {option.sample && (
                    <span className={styles.optionSample} style={option.sampleStyle}>
                      {option.sample}
                    </span>
                  )}
                </div>
              </Fragment>
            ))}
            {filtered.length === 0 && !canUseTyped && <div className={styles.menuEmpty}>{emptyText}</div>}
          </div>
          {canUseTyped && (
            <button type="button" className={styles.menuCustom} onClick={() => choose(typed)}>
              使用 “{typed}”
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- ColorField ---------- */

export function ColorField({ value, onCommit, label }: { value: string; onCommit: (value: string) => void; label: string }) {
  const { shown, push } = useDraft(value, onCommit)
  return (
    <label className={styles.color}>
      <input type="color" className={styles.colorInput} value={shown} aria-label={label} onChange={(event) => push(event.currentTarget.value)} />
      <span className={styles.colorHex}>{shown.toUpperCase()}</span>
    </label>
  )
}
