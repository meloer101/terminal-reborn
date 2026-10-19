// Session metrics in the session header and the overview (PRD F11 / F12, Figma 17): TodoChip 261:9961 + TodoPopover,
// ContextChip 261:9968 + ContextTooltip 261:10030, UsageChip 269:10194 + UsagePopover 269:10201. Numbers only — no
// status colors; ≥ 80 % is drawn heavier. Without data a chip is not drawn at all.
import { Check } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import {
  contextDetail,
  formatReset,
  formatUpdated,
  isHigh,
  liveWindows,
  orderVendors,
  topWindow,
  VENDOR_LABEL,
  windowLabel,
  windowShort,
  type ContextUsage,
  type UsageVendor,
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

/** ContextTooltip appears after the pointer rests this long (Figma 17 ContextTooltip). */
const TOOLTIP_DELAY_MS = 500
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
// Context
// ---------------------------------------------------------------------------------------------

/** `context 62%`; at 80 % and above the number is heavier and /compact puts the command into the input line. */
export function ContextChip({ sessionId, context, compact = true }: { sessionId: SessionId; context: ContextUsage; compact?: boolean }) {
  const high = isHigh(context.percent)
  const [tip, setTip] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const enter = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      setTip(true)
    }, TOOLTIP_DELAY_MS)
  }
  const leave = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setTip(false)
  }
  return (
    <span
      ref={anchor}
      className={styles.chip}
      data-level={high ? 'high' : 'normal'}
      data-testid="context-chip"
      onPointerEnter={enter}
      // Arms again if the pointer was already inside when the chip appeared (no pointerenter then).
      onPointerMove={() => !tip && timer.current === null && enter()}
      onPointerLeave={leave}
    >
      <span className={styles.contextValue}>context {context.percent}%</span>
      {high && compact && (
        <button
          type="button"
          className={styles.compact}
          title="把 /compact 放进输入行（不回车）"
          onMouseDown={keepFocus}
          onClick={() => {
            leave()
            void insertSlashCommand(sessionId, '/compact')
          }}
        >
          /compact
        </button>
      )}
      {tip && <ContextTooltip anchor={anchor} context={context} hint={high && compact} />}
    </span>
  )
}

/** Figma ContextTooltip 261:10030: used / window, and what /compact does. */
function ContextTooltip({ anchor, context, hint }: { anchor: RefObject<HTMLElement | null>; context: ContextUsage; hint: boolean }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = anchor.current?.getBoundingClientRect()
    const width = ref.current?.offsetWidth ?? 0
    if (!box) return
    setPosition({ left: Math.max(8, Math.min(box.left, window.innerWidth - 8 - width)), top: box.bottom + 4 })
  }, [anchor])
  return (
    <div
      ref={ref}
      className={styles.tooltip}
      role="tooltip"
      data-testid="context-tooltip"
      style={position ? { left: position.left, top: position.top } : { visibility: 'hidden' }}
    >
      <span className={styles.tooltipMain}>{contextDetail(context)}</span>
      {hint && <span className={styles.tooltipHint}>点 /compact 把命令放进输入行，回车后压缩</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------------------------

/**
 * One vendor's most used window: `Claude 5h 13%`. Clicking lists every vendor (the current session's first).
 * `current` is the vendor the surrounding view belongs to (null on the overview).
 */
export function UsageChip({ usage, current, all }: { usage: VendorUsage; current: UsageVendor | null; all: VendorUsage[] }) {
  const now = useMetaNow()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const top = topWindow(usage, now)
  if (!top) return null
  const label = VENDOR_LABEL[usage.vendor]
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`${styles.chip} ${styles.usageChip}`}
        data-level={isHigh(top.percent) ? 'high' : 'normal'}
        data-open={open}
        data-testid={`usage-chip-${usage.vendor}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} 额度 ${windowLabel(usage.vendor, top.minutes)}已用 ${top.percent}%`}
        onMouseDown={keepFocus}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.usageVendor} data-part="usage-vendor">
          {label}
        </span>
        <span className={styles.usageValue}>
          {windowShort(top.minutes)} {top.percent}%
        </span>
      </button>
      {open && (
        <Popover anchor={anchor} label="额度" onClose={close} testId="usage-popover">
          <UsageList all={all} current={current} now={now} />
        </Popover>
      )}
    </>
  )
}

const FOOTER_SOURCE: Record<UsageVendor, string> = { claude: 'Claude 来自 statusLine', codex: 'Codex 来自会话日志' }

/** Figma UsagePopover 269:10201. */
function UsageList({ all, current, now }: { all: VendorUsage[]; current: UsageVendor | null; now: number }) {
  const vendors = orderVendors(all, current, now)
  const newest = Math.max(...vendors.map((u) => u.at))
  return (
    <>
      <div className={styles.popoverHeader}>
        <span className={styles.popoverTitle}>额度</span>
        <span className={styles.popoverMeta}>{formatUpdated(newest, now)}</span>
      </div>
      {vendors.map((usage) => (
        <section key={usage.vendor} className={styles.vendor} aria-label={VENDOR_LABEL[usage.vendor]}>
          <div className={styles.vendorName}>
            <span>{VENDOR_LABEL[usage.vendor]}</span>
            {usage.vendor === current && <span className={styles.vendorCurrent}>当前会话</span>}
          </div>
          {liveWindows(usage, now).map((w) => (
            <div key={w.minutes} className={styles.window} data-level={isHigh(w.percent) ? 'high' : 'normal'}>
              <span className={styles.windowLabel}>{windowLabel(usage.vendor, w.minutes)}</span>
              <span className={styles.windowBar} aria-hidden>
                <span className={styles.windowUsed} style={{ width: `${w.percent}%` }} />
              </span>
              <span className={styles.windowValue}>{w.percent}%</span>
              <span className={styles.windowReset}>{w.resetsAt !== undefined ? formatReset(w.resetsAt, now) : ''}</span>
            </div>
          ))}
        </section>
      ))}
      <p className={styles.popoverFooter}>
        {vendors.map((u) => FOOTER_SOURCE[u.vendor]).join('，')}；登录同一账号的会话共用
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Session header group
// ---------------------------------------------------------------------------------------------

/** The header's metrics, in Figma 17A order: todo · context · usage (this session's vendor). */
export function SessionMetaChips({ sessionId, vendor }: { sessionId: SessionId; vendor: UsageVendor | null }) {
  const metrics = useSessionMeta((s) => s.bySession[sessionId])
  const all = useUsageList()
  const now = useMetaNow()
  const usage = vendor ? all.find((u) => u.vendor === vendor) : undefined
  const showsUsage = usage !== undefined && topWindow(usage, now) !== null
  if (!metrics?.todos && !metrics?.context && !showsUsage) return null
  return (
    <span className={styles.headerChips} data-testid="session-meta">
      {metrics?.todos && <TodoChip items={metrics.todos} />}
      {metrics?.context && <ContextChip sessionId={sessionId} context={metrics.context} />}
      {usage && showsUsage && <UsageChip usage={usage} current={vendor} all={all} />}
    </span>
  )
}
