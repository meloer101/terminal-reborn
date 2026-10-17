// The commit graph (PRD F6, Figma 13B / 13H): one 28px row per commit — lanes drawn as SVG, ✓ on the active worktree's
// HEAD, GraphRef pills, subject and age. Rows have a fixed height, so only the visible window is rendered.
import { Check, GitBranch, Globe } from 'lucide-react'
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from 'react'
import type { GraphRow } from '@shared/git-graph/lanes'
import type { GitCommit } from '@shared/git-graph/log'
import { subscribeClock } from '../../sidebar/clock'
import { useWorkspace } from '../../state/workspace'
import { pointerAnchor, popupMenu } from '../../ui/menu'
import { StatusGlyph } from '../../ui/StatusGlyph'
import {
  buildPills,
  commitAge,
  HEAD_NODE_RADIUS,
  laneColor,
  laneX,
  LINE_WIDTH,
  NODE_GAP,
  NODE_RADIUS,
  ROW_HEIGHT,
  rowPaths,
  textLeft,
  type GraphPill,
  type SessionsByPath
} from './graph-model'
import { loadMore, type RootGit } from './store'
import styles from './GitView.module.css'

/** Rows rendered above and below the visible window. */
const OVERSCAN = 12
/** Ask for the next page this many rows before the end. */
const PREFETCH_ROWS = 60

/** The current minute, re-read on the shared clock's tick (ages only show minutes). */
const currentMinute = () => Math.floor(Date.now() / 60_000)

export function GraphView({ root, git, sessions }: { root: string; git: RootGit; sessions: SessionsByPath }) {
  const graph = git.graph
  const scroller = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ top: 0, height: 0 })
  const now = useSyncExternalStore(subscribeClock, currentMinute) * 60_000
  const ready = graph !== undefined && graph !== null
  const pills = useMemo(
    () => (graph ? buildPills(graph.meta.refs, graph.meta.worktrees, sessions) : new Map<string, GraphPill[]>()),
    [graph, sessions]
  )

  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    const measure = () => setViewport({ top: element.scrollTop, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ready])

  // First paint of a repo: bring the active worktree's HEAD into view when it is further down.
  const scrolledFor = useRef<string | null>(null)
  useLayoutEffect(() => {
    const element = scroller.current
    if (!graph || !element || scrolledFor.current === root) return
    scrolledFor.current = root
    const index = graph.commits.findIndex((c) => c.hash === graph.meta.head)
    if (index < 0) return
    const y = index * ROW_HEIGHT
    if (y + ROW_HEIGHT > element.clientHeight) element.scrollTop = Math.max(0, y - element.clientHeight / 3)
  }, [graph, root])

  const count = graph?.commits.length ?? 0
  const first = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(count, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN)

  useEffect(() => {
    if (graph?.hasMore && last >= count - PREFETCH_ROWS) void loadMore(root)
  }, [graph, last, count, root])

  if (graph === undefined) return <p className={styles.empty}>正在读取提交…</p>
  if (graph === null) return <p className={styles.empty}>{git.graphError ? '无法读取 git 历史' : '不是 git 仓库'}</p>
  if (count === 0) return <p className={styles.empty}>还没有提交</p>

  const columns = graph.columns
  const left = textLeft(columns)
  const rows = []
  for (let i = first; i < last; i++) {
    const commit = graph.commits[i]!
    rows.push(
      <CommitRow
        key={commit.hash}
        index={i}
        commit={commit}
        row={graph.rows[i]!}
        head={commit.hash === graph.meta.head}
        pills={pills.get(commit.hash)}
        age={commitAge(now, commit.time)}
        graphWidth={left - NODE_GAP * 2}
        textLeft={left}
      />
    )
  }

  return (
    <div
      ref={scroller}
      className={styles.graph}
      role="list"
      aria-label="提交"
      onScroll={(e) => setViewport({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
    >
      <div className={styles.graphCanvas} style={{ height: count * ROW_HEIGHT }}>
        {rows}
      </div>
      {git.loadingMore && <p className={styles.loadingMore}>正在读取更多提交…</p>}
    </div>
  )
}

interface RowProps {
  index: number
  commit: GitCommit
  row: GraphRow
  head: boolean
  pills: GraphPill[] | undefined
  age: string
  graphWidth: number
  textLeft: number
}

const CommitRow = memo(function CommitRow({ index, commit, row, head, pills, age, graphWidth, textLeft }: RowProps) {
  const setActiveSession = useWorkspace((s) => s.setActiveSession)
  const color = laneColor(row.col)
  const sessionPill = pills?.find((p) => p.kind === 'worktree' && p.sessionId)

  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    void popupMenu(
      [
        ...(sessionPill ? [{ type: 'item' as const, id: 'session', label: `切换到会话 · ${sessionPill.name}` }, { type: 'separator' as const }] : []),
        { type: 'item', id: 'sha', label: '复制 SHA' },
        { type: 'item', id: 'subject', label: '复制提交说明' }
      ],
      pointerAnchor(e)
    ).then((choice) => {
      if (choice === 'session' && sessionPill?.sessionId) setActiveSession(sessionPill.sessionId)
      else if (choice === 'sha') void navigator.clipboard.writeText(commit.hash).catch(() => {})
      else if (choice === 'subject') void navigator.clipboard.writeText(commit.subject).catch(() => {})
    })
  }

  return (
    <div
      className={styles.commit}
      role="listitem"
      data-hash={commit.hash}
      data-head={head || undefined}
      style={{ top: index * ROW_HEIGHT }}
      title={`${commit.hash.slice(0, 8)} · ${commit.author}`}
      onContextMenu={onContextMenu}
    >
      <Lanes row={row} head={head} width={graphWidth} />
      <div className={styles.commitText} style={{ left: textLeft }}>
        {head && <Check size={16} strokeWidth={1.75} className={styles.headCheck} aria-label="当前 worktree 的 HEAD" />}
        {pills?.map((pill) => (
          <RefPill key={`${pill.kind}:${pill.name}`} pill={pill} color={color} onOpen={setActiveSession} />
        ))}
        <span className={styles.subject} data-head={head || undefined}>
          {commit.subject}
        </span>
        <span className={styles.age}>{age}</span>
      </div>
    </div>
  )
})

function Lanes({ row, head, width }: { row: GraphRow; head: boolean; width: number }) {
  // useId() can contain characters url(#…) does not like.
  const mask = `lanes-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  const x = laneX(row.col)
  const radius = head ? HEAD_NODE_RADIUS : NODE_RADIUS
  return (
    <svg className={styles.lanes} width={width} height={ROW_HEIGHT} aria-hidden>
      {/* User-space units: a group of straight lines has a zero-width bounding box, which would hide them all. */}
      <mask id={mask} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={ROW_HEIGHT}>
        <rect width={width} height={ROW_HEIGHT} fill="white" />
        {/* The 2px gap around the node, cut out of the lines so any row background shows through. */}
        <circle cx={x} cy={ROW_HEIGHT / 2} r={radius + NODE_GAP} fill="black" />
      </mask>
      <g mask={`url(#${mask})`} fill="none" strokeWidth={LINE_WIDTH}>
        {rowPaths(row).map((path, i) => (
          <path key={i} d={path.d} stroke={laneColor(path.col)} />
        ))}
      </g>
      <circle data-node cx={x} cy={ROW_HEIGHT / 2} r={radius} fill={laneColor(row.col)} />
    </svg>
  )
}

/** Figma GraphRef (153:210): stroke and icon take the commit's lane colour. */
function RefPill({ pill, color, onOpen }: { pill: GraphPill; color: string; onOpen(sessionId: string): void }) {
  const style = { '--pill-color': color } as CSSProperties
  if (pill.kind === 'worktree' && pill.sessionId && pill.status) {
    const sessionId = pill.sessionId
    return (
      <button
        type="button"
        className={styles.pill}
        data-kind="worktree"
        style={style}
        title={`切换到 ${pill.name} 的会话`}
        onClick={() => onOpen(sessionId)}
      >
        <StatusGlyph status={pill.status} />
        <span className={styles.pillName}>{pill.name}</span>
      </button>
    )
  }
  return (
    <span className={styles.pill} data-kind={pill.kind} style={style} title={pill.name}>
      {pill.kind === 'local' && <GitBranch size={14} strokeWidth={1.75} className={styles.pillIcon} aria-label="本地分支" />}
      {pill.kind === 'remote' && <Globe size={14} strokeWidth={1.75} className={styles.pillIcon} aria-label="远程分支" />}
      <span className={styles.pillName}>{pill.name}</span>
    </span>
  )
}
