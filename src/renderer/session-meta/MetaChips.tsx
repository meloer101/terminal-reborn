// Session metrics in the session header and the overview (PRD F11 / F12, Figma 17 + 18): TodoChip 261:9961 +
// TodoPopover, ContextChip v2 274:10418 + ContextPopover 276:10395, UsageChip v2 274:10443 + UsagePopover v2
// 277:10437. Neutral meters and numbers only — no status colors; near the limit is drawn heavier. No data, no chip.
import { Check } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  contextHigh,
  contextMark,
  contextProjection,
  contextSegments,
  formatClock,
  formatReset,
  formatTokens,
  formatUpdatedNote,
  isHigh,
  liveWindows,
  orderVendors,
  paceNote,
  shareRows,
  shareWindow,
  sparkline,
  topWindow,
  usageChipText,
  VENDOR_LABEL,
  windowKey,
  windowLabel,
  windowPace,
  type ContextHistory,
  type ContextUsage,
  type SessionSpend,
  type UsageVendor,
  type UsageWindow,
  type VendorUsage
} from '@shared/session-meta'
import { todoProgress, todoRowState, type TodoItem } from '@shared/todo-progress'
import type { SessionId } from '@shared/types'
import { insertSlashCommand } from '../session-io'
import { subscribeClock } from '../sidebar/clock'
import { useWorkspace } from '../state/workspace'
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
          type="button"
          className={styles.compact}
          title="把 /compact 放进输入行（不回车）"
          onMouseDown={keepFocus}
          onClick={() => void insertSlashCommand(sessionId, '/compact')}
        >
          /compact
        </button>
      )}
      {open && (
        <Popover anchor={anchor} label="context" onClose={close} testId="context-popover">
          <ContextPanel sessionId={sessionId} context={context} />
        </Popover>
      )}
    </span>
  )
}

const HISTORY_REFRESH_MS = 3_000
const SPARK_WIDTH = 308
const SPARK_HEIGHT = 56

/** Figma 18 ContextPopover 276:10395: how full and how it got there. */
function ContextPanel({ sessionId, context }: { sessionId: SessionId; context: ContextUsage }) {
  const [history, setHistory] = useState<ContextHistory | null>(null)
  // Main reads only what the transcript gained since last time, so the open panel simply asks again now and then
  // (and at once when the figure moves).
  useEffect(() => {
    let live = true
    const load = () =>
      void window.tr.agent.getContextHistory(sessionId).then((next) => {
        if (live) setHistory(next)
      })
    load()
    const timer = setInterval(load, HISTORY_REFRESH_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [sessionId, context.percent])
  const window_ = context.windowTokens ?? history?.windowTokens
  const segments = history && window_ ? contextSegments(history, window_) : []
  const turns = segments.reduce((n, s) => n + s.length, 0)
  const lastSegment = segments[segments.length - 1] ?? []
  const delta = lastSegment.length >= 2 ? lastSegment[lastSegment.length - 1]! - lastSegment[lastSegment.length - 2]! : null
  const mark = contextMark(context)
  const projection = contextProjection(lastSegment, context.compactPercent !== undefined ? { compactPercent: context.compactPercent } : {})
  const high = contextHigh(context)
  return (
    <div className={styles.contextPanel}>
      <div className={styles.popoverHeader}>
        <span className={styles.popoverTitle}>context</span>
        {(context.model || context.windowTokens) && (
          <span className={styles.popoverMeta}>
            {[context.model, context.windowTokens ? `${formatTokens(context.windowTokens)} 窗口` : ''].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      <div className={styles.figure}>
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
        <span className={styles.figureNote} data-testid="context-mark-note">
          {compactNote(context)}
        </span>
      </div>
      {turns >= 2 && (
        <div className={styles.trend} data-testid="context-trend">
          <div className={styles.trendHead}>
            <span className={styles.trendTitle}>最近 {turns} 轮</span>
            {delta !== null && <span className={styles.trendDelta}>本轮 {delta >= 0 ? '+' : '−'}{Math.abs(delta)}%</span>}
          </div>
          <Sparkline segments={segments} guide={mark} />
          {segments.length > 1 && <span className={styles.trendNote}>虚线处压缩过</span>}
          {projection && <span className={styles.projection}>{projection}</span>}
        </div>
      )}
    </div>
  )
}

/** What the bar's mark is: where the agent compacts by itself and how far that is, else the 80 % suggestion. */
function compactNote(context: ContextUsage): string {
  if (context.compactAt === undefined) return '刻度 = 80%，超过后建议 /compact'
  const at = `刻度 = 自动压缩点 ${formatTokens(context.compactAt)}`
  if (context.usedTokens === undefined) return at
  const left = context.compactAt - context.usedTokens
  return left > 0 ? `${at} · 还差 ${formatTokens(left)}` : `${at} · 已到`
}

function Sparkline({ segments, guide }: { segments: number[][]; guide: number }) {
  const { paths, breaks, last, guideY } = sparkline(segments, SPARK_WIDTH, SPARK_HEIGHT, guide)
  return (
    <svg className={styles.sparkline} width={SPARK_WIDTH} height={SPARK_HEIGHT} viewBox={`-3 -3 ${SPARK_WIDTH + 6} ${SPARK_HEIGHT + 6}`} aria-hidden>
      <line className={styles.sparkGuide} x1={0} x2={SPARK_WIDTH} y1={guideY} y2={guideY} />
      {breaks.map((x) => (
        <line key={x} className={styles.sparkBreak} x1={x} x2={x} y1={0} y2={SPARK_HEIGHT} />
      ))}
      {paths.map((d, i) => (
        <path key={i} className={styles.sparkLine} d={d} />
      ))}
      {last && <circle className={styles.sparkNow} cx={last.x} cy={last.y} r={2.5} />}
    </svg>
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
          <UsageList all={all} current={current} now={now} onPick={close} />
        </Popover>
      )}
    </>
  )
}

/** Figma 18 UsagePopover v2 277:10437. */
function UsageList({ all, current, now, onPick }: { all: VendorUsage[]; current: UsageVendor | null; now: number; onPick(): void }) {
  const vendors = orderVendors(all, current, now)
  // Opening the list asks the accounts for fresh figures (main keeps its own minimum gap per vendor).
  useEffect(() => window.tr.agent.refreshUsage(), [])
  const newest = Math.max(...vendors.map((u) => u.at))
  return (
    <div className={styles.usagePanel}>
      <div className={styles.popoverHeader}>
        <span className={styles.popoverTitle}>额度</span>
        <span className={styles.popoverMeta} data-testid="usage-updated">
          {formatUpdatedNote(newest, now)}
        </span>
      </div>
      {vendors.map((usage) => (
        <section key={usage.vendor} className={styles.vendor} aria-label={VENDOR_LABEL[usage.vendor]}>
          <div className={styles.vendorName}>
            <span>{VENDOR_LABEL[usage.vendor]}</span>
            {usage.vendor === current && <span className={styles.vendorCurrent}>当前会话</span>}
          </div>
          {liveWindows(usage, now).map((w) => (
            <WindowBlock key={windowKey(w)} vendor={usage.vendor} w={w} now={now} />
          ))}
          <Shares usage={usage} now={now} onPick={onPick} />
        </section>
      ))}
    </div>
  )
}

/** Figma 18 UsageWindowBlock 277:10429: name · % · reset, a bar with the elapsed tick, and how it is going. */
function WindowBlock({ vendor, w, now }: { vendor: UsageVendor; w: UsageWindow; now: number }) {
  const pace = windowPace(w, now)
  const level = pace.exhausted ? 'exhausted' : pace.runsOutAt !== undefined || isHigh(w.percent) ? 'ahead' : 'normal'
  const note = paceNote(w, now)
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
      {note && <span className={styles.windowNote}>{note}</span>}
    </div>
  )
}

/** Figma 18 SessionShareRow 277:10430: who used the vendor's shortest window, by tokens. */
function Shares({ usage, now, onPick }: { usage: VendorUsage; now: number; onPick(): void }) {
  const w = shareWindow(usage, now)
  const since = w?.resetsAt !== undefined ? w.resetsAt - w.minutes * 60_000 : null
  const [spend, setSpend] = useState<SessionSpend[] | null>(null)
  useEffect(() => {
    if (since === null) return
    let live = true
    void window.tr.agent.getUsageShares(usage.vendor, since).then((next) => {
      if (live) setSpend(next)
    })
    return () => {
      live = false
    }
  }, [usage.vendor, since, usage.at])
  const sessions = useWorkspace((s) => s.sessions)
  const worktrees = useWorkspace((s) => s.worktrees)
  const projects = useWorkspace((s) => s.projects)
  const setActiveSession = useWorkspace((s) => s.setActiveSession)
  if (!w || !spend) return null
  const rows = shareRows(spend, (id) => {
    const session = sessions.find((x) => x.id === id)
    if (!session) return null
    const worktree = worktrees.find((x) => x.id === session.worktreeId)
    const project = projects.find((x) => x.id === worktree?.projectId)
    return { title: session.title, project: project?.name ?? '' }
  })
  if (rows.length === 0) return null
  return (
    <div className={styles.shares} data-testid={`usage-shares-${usage.vendor}`}>
      <div className={styles.sharesHead}>
        <span className={styles.sharesTitle}>这 {windowLabel(usage.vendor, w.minutes)}里各会话的用量</span>
        <span className={styles.sharesNote}>按 API 价格估算</span>
      </div>
      {rows.map((row) => {
        const body = (
          <>
            <span className={styles.shareTitle}>{row.title}</span>
            <span className={styles.shareProject}>{row.project}</span>
            <span className={styles.shareBar} aria-hidden>
              <span className={styles.shareUsed} style={{ width: `${row.percent}%` }} />
            </span>
            <span className={styles.sharePercent}>{row.percent}%</span>
          </>
        )
        return row.sessionId ? (
          <button
            key={row.sessionId}
            type="button"
            className={styles.shareRow}
            onClick={() => {
              onPick()
              setActiveSession(row.sessionId!)
            }}
          >
            {body}
          </button>
        ) : (
          <div key={row.title} className={styles.shareRow} data-muted>
            {body}
          </div>
        )
      })}
    </div>
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
