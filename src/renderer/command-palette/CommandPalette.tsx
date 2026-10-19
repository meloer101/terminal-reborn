// ⌘K command palette (PRD F8): jump to any session or run a common action. Renders nothing while
// closed. Open/close state and the global ⌘K shortcut live in palette-store.ts.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArchiveRestore, FolderPlus, LayoutList, Monitor, Moon, PanelLeft, PanelRight, Plus, Search, Sun, type LucideIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../state/workspace'
import { formatAccelerator } from '../ui/menu-model'
import { StatusGlyph } from '../ui/StatusGlyph'
import styles from './CommandPalette.module.css'
import { buildEntries, rankEntries, stepIndex, type ActionIcon, type PaletteSection, type RankedEntry } from './entries'
import { decidePaletteKey } from './keys'
import type { Range } from './match'
import { closeCommandPalette, usePaletteOpen } from './palette-store'
import { runEntry } from './run'

const ICON = { size: 16, strokeWidth: 1.75 } as const

const ACTION_ICONS: Record<ActionIcon, LucideIcon> = {
  plus: Plus,
  'folder-plus': FolderPlus,
  sidebar: PanelLeft,
  overview: LayoutList,
  panel: PanelRight,
  monitor: Monitor,
  moon: Moon,
  sun: Sun,
  archive: ArchiveRestore
}

const SECTION_TITLE: Record<PaletteSection, string> = { sessions: '会话', actions: '操作', history: '历史' }

function Highlight({ text, ranges }: { text: string; ranges?: Range[] }): ReactNode {
  if (!ranges || ranges.length === 0) return text
  const parts: ReactNode[] = []
  let at = 0
  ranges.forEach(([start, end], i) => {
    if (start > at) parts.push(text.slice(at, start))
    parts.push(
      <mark key={i} className={styles.hit}>
        {text.slice(start, end)}
      </mark>
    )
    at = end
  })
  if (at < text.length) parts.push(text.slice(at))
  return parts
}

/** Sessions highlight inside "project · action"; ranges refer to the individual source fields, so map them here. */
function subtitleRanges(item: RankedEntry): Range[] | undefined {
  const { entry, ranges } = item
  if (entry.section === 'actions') return ranges.subtitle
  // Subtitle is "<project> · <action or branch>"; re-find the matched fields' text inside it.
  const out: Range[] = []
  for (const key of ['project', 'action', 'branch'] as const) {
    const field = entry.fields.find((f) => f.key === key)
    const fieldRanges = ranges[key]
    if (!field || !fieldRanges) continue
    const offset = entry.subtitle.indexOf(field.text)
    if (offset === -1) continue
    for (const [s, e] of fieldRanges) out.push([s + offset, e + offset])
  }
  return out.length > 0 ? out.sort((a, b) => a[0] - b[0]) : undefined
}

export function CommandPalette() {
  const open = usePaletteOpen((s) => s.open)
  return open ? <Sheet /> : null
}

function Sheet() {
  const input = useWorkspace(
    useShallow((s) => ({
      projects: s.projects,
      worktrees: s.worktrees,
      sessions: s.sessions,
      activeSessionId: s.activeSessionId,
      rightPanel: s.rightPanel,
      mainView: s.mainView,
      collapsedProjectIds: s.collapsedProjectIds
    }))
  )
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  // Opened fresh each time, so 历史's "N 天前" is as of opening.
  const [openedAt] = useState(() => Date.now())
  const entries = useMemo(() => buildEntries({ ...input, now: openedAt }), [input, openedAt])
  const results = useMemo(() => rankEntries(entries, query), [entries, query])
  const index = Math.min(selected, Math.max(results.length - 1, 0))
  const optionId = (i: number) => `${listId}-${i}`

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Keep the keyboard selection in view.
  useEffect(() => {
    listRef.current?.querySelector(`[id="${optionId(index)}"]`)?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  const run = (i: number) => {
    const item = results[i]
    if (item) runEntry(item.entry)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const action = decidePaletteKey({
      key: e.key,
      keyCode: e.nativeEvent.keyCode,
      isComposing: e.nativeEvent.isComposing,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey
    })
    if (!action) return
    e.preventDefault()
    if (action === 'next') setSelected(stepIndex(index, results.length, 1))
    else if (action === 'prev') setSelected(stepIndex(index, results.length, -1))
    else if (action === 'run') run(index)
    else if (action === 'close') closeCommandPalette()
    // 'toggle' (⌘K) is handled by the capture-phase listener in palette-store.ts.
  }

  return (
    <div
      className={styles.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeCommandPalette()
      }}
    >
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="命令面板" data-testid="command-palette" onKeyDown={onKeyDown}>
        <div className={styles.inputRow}>
          <span className={styles.icon} aria-hidden="true">
            <Search {...ICON} />
          </span>
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            placeholder="跳转到会话或运行操作…"
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results.length > 0 ? optionId(index) : undefined}
            aria-label="搜索会话和操作"
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
          />
          <span className={styles.kbd} aria-hidden="true">
            esc
          </span>
        </div>
        <div
          ref={listRef}
          id={listId}
          className={styles.list}
          role="listbox"
          aria-label="结果"
          onMouseDown={(e) => e.preventDefault()}
        >
          {results.length === 0 && <div className={styles.empty}>没有匹配项</div>}
          {results.map((item, i) => {
            const { entry } = item
            const header = i === 0 || results[i - 1]!.entry.section !== entry.section
            const Icon = entry.icon ? ACTION_ICONS[entry.icon] : null
            return (
              <div key={entry.id} role="presentation">
                {header && (
                  <div className={styles.section} aria-hidden="true">
                    {SECTION_TITLE[entry.section]}
                  </div>
                )}
                <div
                  id={optionId(i)}
                  className={styles.row}
                  role="option"
                  aria-selected={i === index}
                  data-selected={i === index}
                  data-attention={entry.attention ? 'true' : undefined}
                  data-entry-id={entry.id}
                  onMouseMove={() => i !== index && setSelected(i)}
                  onClick={() => run(i)}
                >
                  <span className={styles.lead}>
                    {entry.status ? <StatusGlyph status={entry.status} /> : Icon && <Icon {...ICON} />}
                  </span>
                  <span className={styles.title}>
                    <Highlight text={entry.title} ranges={item.ranges.title} />
                  </span>
                  <span className={styles.subtitle}>
                    <Highlight text={entry.subtitle} ranges={subtitleRanges(item)} />
                  </span>
                  {entry.shortcut && <kbd className={styles.shortcut}>{formatAccelerator(entry.shortcut)}</kbd>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
