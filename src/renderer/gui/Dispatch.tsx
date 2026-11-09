// Dispatch in a GUI dispatcher's chat (PRD F21 / F23, Figma 68′). Where the agent ran `wavi run`, the fan-out graph:
// the dispatcher on the left, a curve to each session it started (any vendor), their own children one level further;
// a running curve flows outward, a node's ring is its state, a report travels back along its curve. While requests
// wait for 开始 the graph is the confirm (dashed nodes, 拒绝 / 开始 N 个): a GUI dispatcher has no terminal strip.
// Above the composer, the strip keeps every session in view after the graph scrolled away. Wavi's own messages — a
// report, the notice of what the user decided — are drawn as such, never as the user's bubble.
import { memo, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Split } from 'lucide-react'
import { agentLabel, DISPATCH_LIMITS, type PendingStart } from '@shared/dispatch'
import type { AgentKind, SessionId, SessionStatus } from '@shared/types'
import { decideCalls } from '../dispatch/handler'
import { useDispatch } from '../dispatch/store'
import { dispatcherChildIds, dispatchView, stripShown, undrawnWaiting, type DispatchNode, type DispatchView, type NodeState } from '../dispatch/view'
import { useWorkspace } from '../state/workspace'
import { AgentIcon } from '../ui/AgentIcon'
import { StatusGlyph } from '../ui/StatusGlyph'
import { dispatchOutcomes, dispatchRows, elapsedLabel, lastUserAt, reportedChildren, type WaviMessage } from './model'
import { useGuiSessions } from './store'
import styles from './Dispatch.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const
const NO_ITEMS: never[] = []

const GLYPH: Record<NodeState, SessionStatus> = { pending: 'idle', working: 'running', attention: 'needs_you', done: 'done_unread', error: 'error', exited: 'exited' }
const WORD: Record<NodeState, string> = { pending: '等你点开始', working: '运行中', attention: '等你处理', done: '已完成', error: '出错', exited: '已退出' }
const COUNT_ORDER: readonly NodeState[] = ['working', 'attention', 'error', 'done', 'exited']

const open = (id: SessionId): void => useWorkspace.getState().setActiveSession(id)

function useDispatchView(parentId: SessionId, ids: readonly SessionId[]): DispatchView {
  const sessions = useWorkspace((s) => s.sessions)
  const confirms = useDispatch((s) => s.confirms)
  const changes = useDispatch((s) => s.changes)
  const items = useGuiSessions((s) => s.states[parentId]?.items) ?? NO_ITEMS
  const reported = useMemo(() => reportedChildren(items), [items])
  const outcomes = useMemo(() => dispatchOutcomes(items), [items])
  return useMemo(() => dispatchView({ ids, sessions, confirms, changes, reported, outcomes }), [ids, sessions, confirms, changes, reported, outcomes])
}

/** Now, a second at a time while a clock on screen runs. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  return now
}

const ticking = (view: DispatchView): boolean => (view.counts.working ?? 0) + (view.counts.attention ?? 0) > 0

function clock(node: DispatchNode, now: number): string | null {
  if (node.since === undefined) return null
  if (node.state === 'working') return elapsedLabel(now - node.since)
  if (node.state === 'attention') return `已等 ${elapsedLabel(now - node.since)}`
  return node.until !== undefined ? elapsedLabel(node.until - node.since) : null
}

/** `+84 −3 · 2 个文件` with the counts in the diff colours. */
function Changes({ text }: { text: string }) {
  return (
    <span className={styles.changes}>
      {text.split(/(\s+)/).map((part, i) => (
        <span key={i} className={/^\+\d/.test(part) ? styles.add : /^−\d/.test(part) ? styles.del : undefined}>
          {part}
        </span>
      ))}
    </span>
  )
}

function Counts({ view }: { view: DispatchView }) {
  return (
    <span className={styles.counts}>
      {COUNT_ORDER.flatMap((state) => {
        const n = view.counts[state]
        return n ? [
          <span key={state} className={styles.count} title={WORD[state]}>
            <StatusGlyph status={GLYPH[state]} />
            {n}
          </span>
        ] : []
      })}
    </span>
  )
}

// --- the fan-out graph -------------------------------------------------------------------------------------------

const ROW1 = 64
const ROW2 = 46
const PX = 22
const RP = 18
const KX = 236
const R1 = 16
const GX = 296
const R2 = 12
const BEND = 110

interface Placed {
  node: DispatchNode
  x: number
  y: number
  r: number
  /** The level-1 node's centre, for a second-level node. */
  from?: number
}

function layout(view: DispatchView): { placed: Placed[]; height: number; py: number } {
  const placed: Placed[] = []
  let y = 0
  for (const node of view.nodes) {
    const cy = y + ROW1 / 2
    placed.push({ node, x: KX, y: cy, r: R1 })
    y += ROW1
    for (const child of node.children) {
      placed.push({ node: child, x: GX, y: y + ROW2 / 2, r: R2, from: cy })
      y += ROW2
    }
  }
  const height = Math.max(y, 2 * RP + 28)
  return { placed, height, py: height / 2 }
}

const wire = (p: Placed, py: number): string =>
  p.from === undefined
    ? `M ${PX + RP} ${py} C ${PX + RP + BEND} ${py} ${KX - R1 - BEND} ${p.y} ${KX - R1} ${p.y}`
    : `M ${KX} ${p.from + R1} C ${KX} ${p.y} ${KX} ${p.y} ${GX - R2} ${p.y}`

/** The same curve from the node back to the dispatcher: the way a report travels. */
const wireBack = (p: Placed, py: number): string => `M ${KX - R1} ${p.y} C ${KX - R1 - BEND} ${p.y} ${PX + RP + BEND} ${py} ${PX + RP} ${py}`

export function DispatchGraph({ parentId, ids }: { parentId: SessionId; ids: readonly SessionId[] }) {
  const view = useDispatchView(parentId, ids)
  const now = useNow(ticking(view))
  const parentKind = useWorkspace((s) => s.sessions.find((x) => x.id === parentId)?.kind)
  const { placed, height, py } = useMemo(() => layout(view), [view])
  const waiting = view.waiting.length
  const grand = view.nodes.reduce((n, node) => n + node.children.length, 0)
  const first = view.nodes.flatMap((n) => (n.state !== 'pending' && n.since !== undefined ? [n.since] : []))
  const total = !view.settled && first.length > 0 ? elapsedLabel(now - Math.min(...first)) : null

  return (
    <section className={styles.dispatch} data-dispatch-graph data-testid="dispatch-graph" aria-label="派活">
      <div className={styles.head}>
        {waiting > 0 ? <StatusGlyph status="needs_you" /> : <Split {...ICON} className={styles.headIcon} />}
        <span className={styles.headTitle}>
          {waiting > 0 ? `想开 ${waiting} 个会话` : view.nodes.every((n) => n.declined) ? `没有开 ${view.nodes.length} 个会话` : `派出 ${view.nodes.length} 个会话`}
        </span>
        {waiting > 0 ? (
          <span className={styles.muted}>基于 {view.waiting[0]?.plan.item.base === 'snapshot' ? '当前改动的快照' : view.waiting[0]?.base}</span>
        ) : (
          grand > 0 && <span className={styles.muted}>另有 {grand} 个是它们再派的</span>
        )}
        <span className={styles.spacer} />
        {waiting === 0 && <Counts view={view} />}
        {total && <span className={styles.mono}>{total}</span>}
      </div>
      <div className={styles.graph} style={{ height }}>
        <svg className={styles.wires} width="100%" height={height} aria-hidden>
          {placed.map((p) => (
            <g key={p.node.id} data-state={p.node.state}>
              <path className={styles.wire} d={wire(p, py)} />
              {p.node.state === 'working' && <path className={styles.flow} d={wire(p, py)} />}
            </g>
          ))}
          {placed.map((p) => (
            <g key={`n-${p.node.id}`} data-state={p.node.state}>
              {(p.node.state === 'attention' || p.node.state === 'error') && <circle className={styles.halo} cx={p.x} cy={p.y} r={p.r + 6} />}
              <circle className={styles.node} cx={p.x} cy={p.y} r={p.r} />
              {p.node.state === 'working' && (
                <circle className={styles.arc} cx={p.x} cy={p.y} r={p.r} pathLength={100} strokeDasharray="75 100" />
              )}
            </g>
          ))}
        </svg>
        <span className={styles.parent} style={{ left: PX - RP, top: py - RP }}>
          {parentKind && <AgentIcon kind={parentKind} size={16} />}
          {view.reports > 0 && <span className={styles.badge}>{view.reports}</span>}
        </span>
        <span className={styles.parentLabel} style={{ left: PX - RP - 4, top: py + RP + 4 }}>
          派活方
        </span>
        {placed.map((p) => (
          <span key={`m-${p.node.id}`} className={styles.mark} data-state={p.node.state} style={{ left: p.x - (p.r > R2 ? 8 : 6), top: p.y - (p.r > R2 ? 8 : 6) }}>
            {p.node.agent && <AgentIcon kind={p.node.agent} size={p.r > R2 ? 16 : 12} />}
          </span>
        ))}
        {placed.map((p) =>
          p.node.reported && p.from === undefined ? <span key={`back-${p.node.id}`} className={styles.back} style={{ offsetPath: `path("${wireBack(p, py)}")` }} /> : null
        )}
        {placed.map((p) => (
          <NodeLabel key={`l-${p.node.id}`} node={p.node} now={now} left={p.x + p.r + 10} top={p.y} small={p.from !== undefined} />
        ))}
      </div>
      {waiting > 0 && (
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={() => decideCalls(view.waiting.map((c) => c.callId), false)}>
            拒绝
          </button>
          <button type="button" className={styles.primary} onClick={() => decideCalls(view.waiting.map((c) => c.callId), true)} data-testid="dispatch-graph-start">
            开始 {waiting} 个
          </button>
        </div>
      )}
    </section>
  )
}

function NodeLabel({ node, now, left, top, small }: { node: DispatchNode; now: number; left: number; top: number; small: boolean }) {
  const time = clock(node, now)
  const who = node.agent ? [agentLabel(node.agent), node.model].filter(Boolean).join(' · ') : ''
  const strong = node.state === 'attention' || node.state === 'error'
  const status: ReactNode =
    node.state === 'pending' ? (
      <span className={styles.muted}>{node.task}</span>
    ) : (
      <>
        <span data-tone={node.state}>{node.declined === 'declined' ? '你拒绝了' : node.declined === 'timeout' ? '没有回答，没开' : WORD[node.state]}</span>
        {node.action && <span className={styles.action}>· {node.action}</span>}
        {node.state === 'done' && node.reported && <span className={styles.muted}>· 报告已送回</span>}
        {(node.state === 'attention' || node.state === 'error') && !node.gone && (
          <button type="button" className={styles.button} onClick={() => open(node.id)}>
            {node.state === 'attention' ? '去处理' : '打开'}
          </button>
        )}
      </>
    )
  return (
    <span className={styles.label} style={{ left, top }} data-small={small || undefined} data-testid="dispatch-node" data-state={node.state}>
      <span className={styles.line}>
        <button type="button" className={styles.title} data-strong={strong || undefined} disabled={node.gone || node.declined !== undefined || node.state === 'pending'} onClick={() => open(node.id)}>
          {node.gone ? '已不在工作区的会话' : node.title}
        </button>
        {who && <span className={styles.muted}>{who}</span>}
        {small && time && <span className={styles.mono}>{time}</span>}
      </span>
      {!small && node.state !== 'pending' && (node.changes || time) && (
        <span className={styles.line}>
          {node.changes && <Changes text={node.changes} />}
          {time && <span className={styles.mono}>{time}</span>}
        </span>
      )}
      <span className={styles.line}>{status}</span>
    </span>
  )
}

// --- the strip above the composer ---------------------------------------------------------------------------------

const NO_IDS: SessionId[] = []

export function DispatchStripGui({ parentId }: { parentId: SessionId }) {
  const sessions = useWorkspace((s) => s.sessions)
  const confirms = useDispatch((s) => s.confirms)
  const ids = useMemo(() => {
    const list = dispatcherChildIds(parentId, sessions, confirms)
    return list.length > 0 ? list : NO_IDS
  }, [sessions, confirms, parentId])
  const view = useDispatchView(parentId, ids)
  const items = useGuiSessions((s) => s.states[parentId]?.items) ?? NO_ITEMS
  const since = useMemo(() => lastUserAt(items), [items])
  // Requests no graph draws (the feed could not read the call): answered here, or nowhere — GUI has no terminal strip.
  const drawn = useMemo(() => new Set([...dispatchRows(items).values()].flatMap((row) => (row.kind === 'graph' ? row.ids : []))), [items])
  const orphans = useMemo(() => undrawnWaiting(parentId, confirms, drawn), [parentId, confirms, drawn])
  const now = useNow(ticking(view))
  const [expanded, setExpanded] = useState(false)
  const crew = stripShown(view, since) && view.nodes.some((n) => n.state !== 'pending')
  if (!crew && orphans.length === 0) return null
  if (!crew) return <WaitingStrip waiting={orphans} />
  const all = view.nodes.flatMap((n) => [n, ...n.children.map((c) => ({ ...c, nested: true }))]) as (DispatchNode & { nested?: true })[]
  const urgent = view.urgent
  // The graph of this chat (a split shows more than one), its latest.
  const showGraph = (event: MouseEvent<HTMLElement>): void => {
    const graphs = event.currentTarget.closest('[data-gui-chat]')?.querySelectorAll('[data-dispatch-graph]')
    graphs?.[graphs.length - 1]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  return (
    <>
    {orphans.length > 0 && <WaitingStrip waiting={orphans} />}

    <div className={styles.strip} data-settled={view.settled || undefined} data-testid="dispatch-crew">
      <div className={styles.stripHead}>
        <span className={styles.avatars}>
          {all.slice(0, 6).map((n) => (
            <span key={n.id} className={styles.ring} data-state={view.settled ? 'settled' : n.state}>
              {n.agent && <AgentIcon kind={n.agent} size={12} />}
            </span>
          ))}
        </span>
        {view.settled ? (
          <>
            <span className={styles.stripTitle} data-quiet>
              {all.length} 个会话都结束了
            </span>
            <span className={styles.muted}>{view.reports} 份报告</span>
          </>
        ) : (
          <>
            <span className={styles.stripTitle}>派出 {view.nodes.length} 个会话</span>
            <Counts view={view} />
          </>
        )}
        <span className={styles.spacer} />
        {!expanded && urgent && (
          <>
            <span className={styles.urgent} data-tone={urgent.state}>
              {urgent.agent ? agentLabel(urgent.agent) : '会话'} {urgent.state === 'error' ? '出错' : urgent.action ? `要${urgent.action}` : '等你处理'}
            </span>
            <button type="button" className={styles.button} onClick={() => open(urgent.id)}>
              {urgent.state === 'error' ? '打开' : '去处理'}
            </button>
          </>
        )}
        {expanded && (
          <button type="button" className={styles.link} onClick={showGraph}>
            <Split {...ICON} size={14} />
            看图
          </button>
        )}
        <button type="button" className={styles.toggle} aria-label={expanded ? '收起' : '展开'} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
        </button>
      </div>
      {expanded && (
        <div className={styles.rows}>
          {all.map((n) => {
            const time = clock(n, now)
            return (
              <div key={n.id} className={styles.row} data-nested={n.nested || undefined}>
                <StatusGlyph status={GLYPH[n.state]} />
                {n.agent && <AgentIcon kind={n.agent} size={14} />}
                <span className={styles.rowTitle}>{n.gone ? '已不在工作区的会话' : n.title}</span>
                <span className={styles.action} data-tone={n.state === 'attention' || n.state === 'error' ? n.state : undefined}>
                  {n.state === 'working' || n.state === 'attention' ? (n.action ?? WORD[n.state]) : n.state === 'pending' ? n.task : WORD[n.state]}
                </span>
                <span className={styles.spacer} />
                {time && <span className={styles.mono}>{time}</span>}
                {!n.gone && n.state !== 'pending' && (
                  <button type="button" className={styles.link} onClick={() => open(n.id)}>
                    打开
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
    </>
  )
}

/** Requests waiting for 开始 that no graph shows: the same answer as the graph's, for exactly these. */
function WaitingStrip({ waiting }: { waiting: readonly PendingStart[] }) {
  const calls = waiting.map((c) => c.callId)
  return (
    <div className={styles.strip} data-testid="dispatch-waiting">
      <div className={styles.stripHead}>
        <StatusGlyph status="needs_you" />
        <span className={styles.stripTitle}>想开 {waiting.length} 个会话</span>
        <span className={styles.spacer} />
        <button type="button" className={styles.button} onClick={() => decideCalls(calls, false)}>
          拒绝
        </button>
        <button type="button" className={styles.primary} onClick={() => decideCalls(calls, true)}>
          开始 {waiting.length} 个
        </button>
      </div>
      <div className={styles.rows}>
        {waiting.map((c) => (
          <div key={c.callId} className={styles.row}>
            <AgentIcon kind={c.plan.item.agent} size={14} />
            <span className={styles.rowTitle}>{c.plan.item.title}</span>
            <span className={styles.action}>{c.plan.item.task.split('\n', 1)[0]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Wavi's own messages -------------------------------------------------------------------------------------------

const EVENT_STATE = { report: 'done', done: 'done', error: 'error', exited: 'exited' } as const
const EVENT_WORD = { report: '发来报告', done: '一轮结束', error: '出错', exited: 'agent 已退出' } as const

/** A dispatch report: one card per child, its agent's mark beside it; a notice: one quiet line. */
export const WaviMessageView = memo(function WaviMessageView({ message, time }: { message: WaviMessage; time: string }) {
  if (message.kind === 'notice') {
    const { outcome, titles } = message.notice
    const text =
      outcome === 'started'
        ? `已开始 ${titles.length} 个会话：${titles.join('、')}`
        : outcome === 'declined'
          ? `你拒绝了 ${titles.length} 个会话`
          : `${Math.round(DISPATCH_LIMITS.confirmMs / 60_000)} 分钟没有回答，没有开 ${titles.length} 个会话`
    return (
      <p className={styles.notice} data-testid="dispatch-notice">
        <Split {...ICON} size={14} />
        {text}
      </p>
    )
  }
  return (
    <div className={styles.reports}>
      {message.reports.map((r) => (
        <ReportCard key={r.childId} report={r} time={time} />
      ))}
    </div>
  )
})

function ReportCard({ report: r, time }: { report: Extract<WaviMessage, { kind: 'report' }>['reports'][number]; time: string }) {
  // Only this child's kind: a card does not redraw when any other session changes.
  const kind: AgentKind | undefined = useWorkspace((s) => s.sessions.find((x) => x.id === r.childId)?.kind)
  const state = r.event ? EVENT_STATE[r.event] : 'done'
  return (
    <article className={styles.report} data-testid="dispatch-report">
      <span className={styles.reportAvatar} aria-hidden>
        {kind && <AgentIcon kind={kind} size={16} />}
        <span className={styles.dot} data-state={state} />
      </span>
      <div className={styles.reportCard}>
        <div className={styles.line}>
          <span className={styles.reportAgent}>{r.agent}</span>
          <span className={styles.muted}>报告</span>
          <span className={styles.reportTitle}>{r.title}</span>
          <StatusGlyph status={GLYPH[state]} />
          <span className={styles.muted}>{r.event ? EVENT_WORD[r.event] : ''}</span>
          <span className={styles.spacer} />
          <span className={styles.muted}>{time}</span>
        </div>
        {r.facts.length > 0 && (
          <div className={styles.line}>
            <Changes text={r.facts.join(' · ')} />
          </div>
        )}
        {r.excerpt && <p className={styles.excerpt}>{r.excerpt}</p>}
        {kind && (
          <button type="button" className={styles.link} onClick={() => open(r.childId)}>
            打开会话
            <ChevronRight {...ICON} size={14} />
          </button>
        )}
      </div>
    </article>
  )
}
