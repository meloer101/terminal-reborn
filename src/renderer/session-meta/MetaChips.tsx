// Session metrics in the session header and the overview (PRD F11 / F12, Figma 17 + 18 + 27): TodoChip 261:9961 +
// TodoPopover, ContextChip v2 274:10418 + ContextPopover (27B), UsageChip v2 274:10443 + UsagePopover (27B). The two
// popovers show only the figures — no captions, no trend. Neutral meters and numbers only — no status colors; near
// the limit is drawn heavier. No data, no chip.
import { Check } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  contextHigh,
  contextMark,
  formatClock,
  formatReset,
  formatTokens,
  isHigh,
  liveWindows,
  orderVendors,
  topWindow,
  usageChipText,
  VENDOR_LABEL,
  windowKey,
  windowLabel,
  windowPace,
  type ContextUsage,
  type UsageVendor,
  type UsageWindow,
  type VendorUsage
} from '@shared/session-meta'
import { todoProgress, todoRowState, type TodoItem } from '@shared/todo-progress'
import type { SessionId } from '@shared/types'
import { insertSlashCommand } from '../session-io'
import { subscribeClock } from '../sidebar/clock'
import { StatusGlyph } from '../ui/StatusGlyph'
import { Popover } from './Popover'
import { useSessionMeta } from './store'
import styles from './SessionMeta.module.css'

const CLOCK_MS = 15_000

/** "Now" on the shared 15 s clock: usage windows that reset drop out, "N 分钟前更新" moves on. */
export function useMetaNow(): number {
  return useSyncExternalStore(subscribeClock, () => Math.floor(Date.now() / CLOCK_MS) * CLOCK_MS)
}

const EMPTY: VendorUsage[] = []

/** A click on a chip leaves the keyboard in the terminal (the agent keeps its input); Tab still reaches the chip. */
const keepFocus = (event: { preventDefault(): void }) => event.preventDefault()

/** Every vendor's usage that still says something about now. */
export function useUsageList(): VendorUsage[] {
  const usage = useSessionMeta((s) => s.usage)
  const list = Object.values(usage) as VendorUsage[]
  return list.length > 0 ? list : EMPTY
}

// ---------------------------------------------------------------------------------------------
// Todo
// ---------------------------------------------------------------------------------------------

export function TodoChip({ items }: { items: TodoItem[] }) {
  const progress = todoProgress(items)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  if (!progress) return null
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`${styles.chip} ${styles.todoChip}`}
        data-open={open}
        data-testid="todo-chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`任务 ${progress.done}/${progress.total}：${progress.current}`}
        onMouseDown={keepFocus}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.todoCount}>
          {progress.done}/{progress.total}
        </span>
        {/* data-part: the session header drops these first when it narrows (SessionHeader.module.css). */}
        <span className={styles.todoCurrent} data-part="todo-current">
          {progress.current}
        </span>
      </button>
      {open && (
        <Popover anchor={anchor} label="任务" onClose={close} testId="todo-popover">
          <TodoList items={items} done={progress.done} />
        </Popover>
      )}
    </>
  )
}

/** Figma TodoPopover 261:9986. */
function TodoList({ items, done }: { items: TodoItem[]; done: number }) {
  return (
    <>
      <div className={styles.popoverHeader}>
        <span className={styles.popoverTitle}>任务</span>
        <span className={styles.popoverMeta}>
          {done} / {items.length} 已完成
        </span>
      </div>
      <ol className={styles.todoItems}>
        {items.map((item, index) => {
          const state = todoRowState(items, index)
          return (
            <li key={item.id} className={styles.todoItem} data-state={state} title={item.text}>
              <span className={styles.todoIcon} aria-hidden>
                {state === 'done' ? <Check size={16} strokeWidth={1.75} /> : <StatusGlyph status={state === 'current' ? 'running' : 'idle'} />}
              </span>
              <span className={styles.todoText}>{item.text}</span>
            </li>
          )
        })}
      </ol>
      <p className={styles.popoverFooter}>来自 Claude 的 TodoWrite · 只读</p>
    </>
  )
}

/** Sidebar SessionRow's 1px progress line (Figma SessionRow 11:51 · TodoLine 79:408). */
export function TodoLine({ sessionId }: { sessionId: SessionId }) {
  const items = useSessionMeta((s) => s.bySession[sessionId]?.todos)
  const progress = items ? todoProgress(items) : null
  if (!progress) return null
  return (
    <span className={styles.todoLine} data-testid="todo-line" aria-hidden>
      <span className={styles.todoLineDone} style={{ width: `${(progress.done / progress.total) * 100}%` }} />
    </span>
  )
}

// ---------------------------------------------------------------------------------------------
// Meter
// ---------------------------------------------------------------------------------------------

/** Figma 18 MiniMeter 274:10397: used, and (for plan windows) a tick where the window's time stands. */
function MiniMeter({ percent, elapsed }: { percent: number; elapsed?: number | undefined }) {
  return (
    <span className={styles.meter} aria-hidden>
      <span className={styles.meterUsed} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      {elapsed !== undefined && <span className={styles.meterTick} style={{ left: `${Math.round(elapsed * 100)}%` }} />}
    </span>
  )
}

// ---------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------

/**
 * ContextChip v2 (Figma 18 274:10418): always shown once the agent reported it; a click opens ContextPopover.
 * Where the agent itself starts warning (20k before it compacts by itself; else 80 %) the number is heavier and
 * /compact puts the command into the input line.
 */
export function ContextChip({ sessionId, context, compact = true }: { sessionId: SessionId; context: ContextUsage; compact?: boolean }) {
  const high = contextHigh(context)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  // Why /compact did not reach the input line (a menu is open in the terminal); the popover hangs under the button.
  const [refusal, setRefusal] = useState<string | null>(null)
  const compactButton = useRef<HTMLButtonElement>(null)
  const closeRefusal = useCallback(() => setRefusal(null), [])
  const insertCompact = (): void => {
    setRefusal(null)
    insertSlashCommand(sessionId, '/compact').catch((error: unknown) => setRefusal(error instanceof Error ? error.message : '没有放进输入行'))
  }
  return (
    <span className={styles.chipGroup} data-testid="context-chip" data-level={high ? 'high' : 'normal'}>
      <button
        ref={anchor}
        type="button"
        className={styles.chip}
        data-level={high ? 'high' : 'normal'}
        data-open={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`context 已用 ${context.percent}%`}
        onMouseDown={keepFocus}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.contextLabel}>context</span>
        <MiniMeter percent={context.percent} />
        <span className={styles.contextValue}>{context.percent}%</span>
      </button>
      {high && compact && (
        <button
          ref={compactButton}
          type="button"
          className={styles.compact}
          title="把 /compact 放进输入行（不回车）"
          onMouseDown={keepFocus}
          onClick={insertCompact}
        >
          /compact
        </button>
      )}
      {refusal && (
        <Popover anchor={compactButton} label="/compact" onClose={closeRefusal} testId="compact-refusal">
          <p className={styles.refusal} role="status">
            {refusal}
          </p>
        </Popover>
      )}
      {open && (
        <Popover anchor={anchor} label="context" onClose={close} testId="context-popover">
          <ContextPanel context={context} />
        </Popover>
      )}
    </span>
  )
}

/** Figma 27B: how full the window is, nothing else. */
function ContextPanel({ context }: { context: ContextUsage }) {
  const mark = contextMark(context)
  const high = contextHigh(context)
  return (
    <div className={styles.contextPanel}>
      <div className={styles.figureRow}>
        <span className={styles.figureUsed}>{context.usedTokens !== undefined ? formatTokens(context.usedTokens) : `${context.percent}%`}</span>
        {context.usedTokens !== undefined && context.windowTokens !== undefined && (
          <span className={styles.figureWindow}>/ {formatTokens(context.windowTokens)}</span>
        )}
        <span className={styles.figurePercent} data-level={high ? 'high' : 'normal'}>
          {context.percent}%
        </span>
      </div>
      <span className={styles.bigBar} data-level={high ? 'high' : 'normal'} aria-hidden>
        <span className={styles.bigBarUsed} style={{ width: `${context.percent}%` }} />
        <span className={styles.bigBarMark} style={{ left: `${mark}%` }} />
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------------------------

/**
 * UsageChip v2 (Figma 18 274:10443): one vendor's most used window with a tick for its elapsed time, or
 * `5h 用完 · 14:20 恢复`. Clicking lists every vendor. `current` is the view's vendor (null on the overview);
 * with `opensOnRequest` it also opens when a usage notification was clicked (store · usageOpenPending).
 */
export function UsageChip({ usage, current, all, opensOnRequest = false }: { usage: VendorUsage; current: UsageVendor | null; all: VendorUsage[]; opensOnRequest?: boolean }) {
  const now = useMetaNow()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useEffect(() => {
    if (!opensOnRequest) return
    const take = () => {
      if (!useSessionMeta.getState().usageOpenPending) return
      useSessionMeta.getState().consumeUsageOpen()
      setOpen(true)
    }
    const off = useSessionMeta.subscribe(take)
    // The request may have come before this chip mounted (the click also switched to the overview).
    queueMicrotask(take)
    return off
  }, [opensOnRequest])
  const top = topWindow(usage, now)
  if (!top) return null
  const label = VENDOR_LABEL[usage.vendor]
  const pace = windowPace(top, now)
  const level = pace.exhausted ? 'exhausted' : isHigh(top.percent) ? 'high' : 'normal'
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`${styles.chip} ${styles.usageChip}`}
        data-level={level}
        data-open={open}
        data-testid={`usage-chip-${usage.vendor}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} 额度 ${windowLabel(usage.vendor, top.minutes, top.scope)}${pace.exhausted ? '已用完' : `已用 ${top.percent}%`}`}
        onMouseDown={keepFocus}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.usageVendor} data-part="usage-vendor">
          {label}
        </span>
        {!pace.exhausted && <MiniMeter percent={top.percent} elapsed={pace.elapsed} />}
        <span className={styles.usageValue}>{usageChipText(top, now)}</span>
      </button>
      {open && (
        <Popover anchor={anchor} label="额度" onClose={close} testId="usage-popover">
          <UsageList all={all} current={current} now={now} />
        </Popover>
      )}
    </>
  )
}

/** Figma 27B: every vendor's windows, current session's vendor first. */
function UsageList({ all, current, now }: { all: VendorUsage[]; current: UsageVendor | null; now: number }) {
  const vendors = orderVendors(all, current, now)
  // Opening the list asks the accounts for fresh figures (main keeps its own minimum gap per vendor).
  useEffect(() => window.tr.agent.refreshUsage(), [])
  return (
    <div className={styles.usagePanel}>
      {vendors.map((usage) => (
        <section key={usage.vendor} className={styles.vendor} aria-label={VENDOR_LABEL[usage.vendor]}>
          <div className={styles.vendorName}>{VENDOR_LABEL[usage.vendor]}</div>
          {liveWindows(usage, now).map((w) => (
            <WindowBlock key={windowKey(w)} vendor={usage.vendor} w={w} now={now} />
          ))}
        </section>
      ))}
    </div>
  )
}

/** Figma 27B: name · % · reset and a bar with a tick where the window's time stands; ahead of that tick reads heavier. */
function WindowBlock({ vendor, w, now }: { vendor: UsageVendor; w: UsageWindow; now: number }) {
  const pace = windowPace(w, now)
  const level = pace.exhausted ? 'exhausted' : pace.runsOutAt !== undefined || isHigh(w.percent) ? 'ahead' : 'normal'
  return (
    <div className={styles.windowBlock} data-level={level} data-testid={`usage-window-${vendor}-${windowKey(w).replace(':', '-')}`}>
      <div className={styles.windowHead}>
        <span className={styles.windowLabel}>{windowLabel(vendor, w.minutes, w.scope)}</span>
        <span className={styles.windowValue}>{w.percent}%</span>
        <span className={styles.windowReset}>
          {w.resetsAt !== undefined ? (pace.exhausted ? `${formatClock(w.resetsAt, now)} 恢复` : formatReset(w.resetsAt, now)) : ''}
        </span>
      </div>
      <span className={styles.bigBar} aria-hidden>
        <span className={styles.bigBarUsed} style={{ width: `${Math.min(100, w.percent)}%` }} />
        {!pace.exhausted && pace.elapsed !== undefined && <span className={styles.bigBarTick} style={{ left: `${Math.round(pace.elapsed * 100)}%` }} />}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Session header group
// ---------------------------------------------------------------------------------------------

/** The header's metrics, in Figma 17A order: todo · context · usage (this session's vendor) · `children` (actions on them). */
export function SessionMetaChips({ sessionId, vendor, children }: { sessionId: SessionId; vendor: UsageVendor | null; children?: ReactNode }) {
  const metrics = useSessionMeta((s) => s.bySession[sessionId])
  const all = useUsageList()
  const now = useMetaNow()
  // Off the plan (a third-party endpoint), the account's usage is not this session's.
  const usage = vendor && metrics?.plan !== false ? all.find((u) => u.vendor === vendor) : undefined
  const showsUsage = usage !== undefined && topWindow(usage, now) !== null
  if (!metrics?.todos && !metrics?.context && !showsUsage && !children) return null
  return (
    <span className={styles.headerChips} data-testid="session-meta">
      {metrics?.todos && <TodoChip items={metrics.todos} />}
      {metrics?.context && <ContextChip sessionId={sessionId} context={metrics.context} />}
      {usage && showsUsage && <UsageChip usage={usage} current={vendor} all={all} />}
      {children}
    </span>
  )
}
