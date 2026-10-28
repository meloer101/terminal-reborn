// Worktree view (PRD F17, Figma 13C `149:5973`): every git worktree of the active session's project with the status
// of its sessions, uncommitted stats and ahead / behind; the selected row expands into details and actions. Merged
// worktrees without a session sit in 可清理 (one 清理 for all); other session-less ones in 没有会话 (one by one).
// Refreshes on window focus, when git's worktree / branch files change, every POLL_MS while visible, and — only the
// worktrees concerned — when their sessions change.
import { Ellipsis, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { SHORTCUTS } from '@shared/shortcuts'
import type { ProjectId, Session, WorktreeId } from '@shared/types'
import { newSessionInProject } from '../../state/session-actions'
import { useWorkspace } from '../../state/workspace'
import { IconButton } from '../../ui/IconButton'
import { formatAccelerator } from '../../ui/menu-model'
import { StatusGlyph } from '../../ui/StatusGlyph'
import { openMergeSheet } from '../merge/store'
import { agentLabel, agentSessionFor } from '../merge/model'
import { wantsRebase } from '@shared/conflict-radar'
import { rebaseWithAgent } from '../../conflict-radar/actions'
import { radarDetailLines } from '../../conflict-radar/model'
import { RadarTag } from '../../conflict-radar/RadarTag'
import { useWorktreeRadarMark } from '../../conflict-radar/store'
import { useRepoScripts } from '../../scripts/run-script'
import { PaneHeader } from '../PaneHeader'
import { cleanUpInteractive, openRowMenu, selectRow } from './actions'
import { buildRows, detailLines, selectedRow, tildePath, type WorktreeGroups, type WorktreeRow } from './model'
import { patchRoot, refreshWorktrees, useWorktrees, worktreesOf } from './store'
import styles from './WorktreeView.module.css'

/** Session changes (new, closed, status) come in bursts; list once they settle. */
const SESSION_REFRESH_DELAY_MS = 400
/** Catches what no event reports (edits inside a worktree), only while the window is visible. */
const POLL_MS = 20_000

interface Props {
  projectId: ProjectId
  /** The project's main checkout. */
  root: string
  projectName: string
  activeWorktreeId: WorktreeId | null
}

/** Per workspace worktree: its sessions and their states, to tell which worktrees a session change touched. */
function sessionKeys(sessions: readonly Session[]): Map<WorktreeId, string> {
  const keys = new Map<WorktreeId, string>()
  for (const s of sessions) keys.set(s.worktreeId, `${keys.get(s.worktreeId) ?? ''}${s.id}:${s.status};`)
  return keys
}

export function WorktreeView({ projectId, root, projectName, activeWorktreeId }: Props) {
  const state = useWorktrees((s) => s.roots[root]) ?? worktreesOf(root)
  const worktrees = useWorkspace(useShallow((s) => s.worktrees.filter((w) => w.projectId === projectId)))
  const sessions = useWorkspace(
    useShallow((s) => {
      const ids = new Set(worktrees.map((w) => w.id))
      return s.sessions.filter((x) => ids.has(x.worktreeId))
    })
  )
  const knownPaths = useMemo(() => worktrees.map((w) => w.path), [worktrees])
  const refresh = useCallback((only?: string[]) => refreshWorktrees(root, knownPaths, only), [root, knownPaths])
  const refreshAll = useCallback(() => refresh(), [refresh])

  const groups = useMemo(() => (state.listing ? buildRows(state.listing, worktrees, sessions) : null), [state.listing, worktrees, sessions])
  // The session-change timer below maps worktree ids to rows when it fires, not when it was set.
  const groupsRef = useRef<WorktreeGroups | null>(groups)
  useEffect(() => {
    groupsRef.current = groups
  }, [groups])

  // Sessions opening, closing or changing state (an agent finishing a turn commits): list those worktrees again.
  const previousKeys = useRef<Map<WorktreeId, string> | null>(null)
  const keys = useMemo(() => sessionKeys(sessions), [sessions])
  useEffect(() => {
    const before = previousKeys.current
    previousKeys.current = keys
    if (!before || worktreesOf(root).listing === undefined) {
      void refresh()
      return
    }
    const changed = [...new Set([...before.keys(), ...keys.keys()])].filter((id) => before.get(id) !== keys.get(id))
    if (changed.length === 0) return
    const timer = setTimeout(() => {
      const rows = groupsRef.current ? [...groupsRef.current.working, ...groupsRef.current.cleanable, ...groupsRef.current.idle] : []
      const paths = changed.map((id) => rows.find((r) => r.worktreeIds.includes(id))?.key)
      // A worktree the listing does not know yet (a session in a new folder): list everything.
      void (paths.every((p) => p !== undefined) ? refresh(paths as string[]) : refresh())
    }, SESSION_REFRESH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [root, refresh, keys])

  useEffect(() => {
    window.addEventListener('focus', refreshAll)
    const offChanged = window.tr.gitWorktrees.onChanged((changedRoot) => {
      if (changedRoot === root) void refreshAll()
    })
    window.tr.gitWorktrees.watch(root)
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshAll()
    }, POLL_MS)
    return () => {
      window.removeEventListener('focus', refreshAll)
      offChanged()
      window.tr.gitWorktrees.unwatch(root)
      clearInterval(poll)
    }
  }, [root, refreshAll])

  // Switching sessions anywhere else moves the selection to the new session's worktree.
  useEffect(() => patchRoot(root, { picked: null }), [root, activeWorktreeId])

  const selected = groups ? selectedRow([...groups.working, ...groups.cleanable, ...groups.idle], state.picked, activeWorktreeId) : null
  const rowProps = { projectId, root, refresh: refreshAll }

  const empty =
    state.listing === undefined ? '正在读取 worktree…' : state.listing === null ? (state.failed ? '无法读取 worktree' : '不是 git 仓库') : null

  return (
    <>
      <PaneHeader title="Worktree" context={projectName}>
        <IconButton
          label="新建会话"
          title="新建会话 · ⌘N"
          aria-haspopup="dialog"
          onClick={() => newSessionInProject(projectId)}
        >
          <Plus size={16} strokeWidth={1.75} />
        </IconButton>
      </PaneHeader>
      {state.notice && (
        <p className={styles.notice} role="status">
          {state.notice}
        </p>
      )}
      {empty || !groups ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <div className={styles.body}>
          <ul className={styles.list} aria-label="Worktree">
            {groups.working.map((row) => (
              <Row key={row.key} row={row} selected={row === selected} {...rowProps} />
            ))}
          </ul>
          {groups.cleanable.length > 0 && (
            <section aria-label="可清理">
              <div className={styles.groupHeader}>
                <h3 className={styles.groupTitle}>可清理</h3>
                <span className={styles.groupHint}>已合并且没有会话</span>
                <button
                  type="button"
                  className={styles.ghost}
                  disabled={state.busy}
                  onClick={() => void cleanUpInteractive(root, groups.cleanable, refreshAll)}
                >
                  清理
                </button>
              </div>
              <ul className={styles.list} aria-label="可清理">
                {groups.cleanable.map((row) => (
                  <Row key={row.key} row={row} selected={row === selected} {...rowProps} />
                ))}
              </ul>
            </section>
          )}
          {groups.idle.length > 0 && (
            <section aria-label="没有会话">
              <div className={styles.groupHeader}>
                <h3 className={styles.groupTitle}>没有会话</h3>
                <span className={styles.groupHint}>未合并，不会被一键清理</span>
              </div>
              <ul className={styles.list} aria-label="没有会话">
                {groups.idle.map((row) => (
                  <Row key={row.key} row={row} selected={row === selected} {...rowProps} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  )
}

interface RowProps {
  row: WorktreeRow
  selected: boolean
  projectId: ProjectId
  root: string
  refresh: () => Promise<void>
}

/** Figma component WorktreeRow (130:282); the selected one expands into "Details" (149:6262). */
function Row({ row, selected, projectId, root, refresh }: RowProps) {
  const { info } = row
  const scripts = useRepoScripts(selected ? info.path : undefined)
  const radar = useWorktreeRadarMark(root, row.worktreeIds)
  const activeSessionId = useWorkspace((s) => s.activeSessionId)
  const rebaseTarget = radar && wantsRebase(radar.self) ? agentSessionFor(row.sessions, activeSessionId) : null
  return (
    <li className={styles.item} data-selected={selected} data-path={info.path}>
      <button type="button" className={styles.row} aria-expanded={selected} onClick={() => selectRow(root, row)}>
        <span className={styles.line}>
          {row.status ? (
            <StatusGlyph status={row.status} />
          ) : (
            <span aria-hidden className={styles.noSession}>
              <StatusGlyph status="exited" />
            </span>
          )}
          <span className={styles.name}>{row.name}</span>
          {row.diff && <span className={styles.mono}>{row.diff}</span>}
          <span className={styles.mono} title={info.base ? `相对 ${info.base} 领先 ${info.ahead ?? 0}，落后 ${info.behind ?? 0}` : undefined}>
            {row.sync}
          </span>
        </span>
        <span className={styles.meta}>
          <span className={styles.session}>{row.sessionLine}</span>
          {radar && <RadarTag mark={radar} />}
          <span className={styles.path}>{tildePath(row.openPath, window.tr.homeDir)}</span>
        </span>
      </button>
      {selected && (
        <div className={styles.details}>
          <dl className={styles.kv}>
            {detailLines(info, scripts?.port ?? null).map((line) => (
              <div key={line.label} className={styles.kvRow}>
                <dt className={styles.kvLabel}>{line.label}</dt>
                <dd className={styles.kvValue} data-mono={line.mono || undefined}>
                  {line.value}
                </dd>
              </div>
            ))}
            {radar &&
              radarDetailLines(radar).map((line, i) => (
                <div key={`radar-${i}`} className={styles.kvRow} data-testid="radar-detail">
                  <dt className={styles.kvLabel}>{line.label}</dt>
                  <dd className={styles.kvValue} title={line.title}>
                    {line.value}
                  </dd>
                </div>
              ))}
          </dl>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.action}
              disabled={info.prunable !== null}
              onClick={() => window.tr.worktree.reveal(row.openPath, '')}
            >
              打开文件夹
            </button>
            {info.base && !info.isMain && !info.merged && (
              <button
                type="button"
                className={styles.action}
                disabled={info.prunable !== null}
                onClick={() =>
                  openMergeSheet({ projectId, root, worktreePath: info.path, worktreeIds: row.worktreeIds, isMain: info.isMain })
                }
              >
                合并到 {info.base}…<span className={styles.shortcut}>{formatAccelerator(SHORTCUTS['merge-worktree'])}</span>
              </button>
            )}
            {radar && rebaseTarget && (
              <button
                type="button"
                className={styles.action}
                title={`把 rebase 说明放进 ${agentLabel(rebaseTarget.kind)} 的输入行，看过后按回车发送`}
                onClick={() =>
                  void rebaseWithAgent(radar.self, rebaseTarget).then((error) => {
                    if (error) patchRoot(root, { notice: `没能交给 ${agentLabel(rebaseTarget.kind)}：${error}` })
                  })
                }
              >
                让 agent rebase
              </button>
            )}
            <span className={styles.spacer} />
            <IconButton
              label="更多"
              aria-haspopup="menu"
              onClick={(e) => void openRowMenu(projectId, root, row, e.currentTarget, refresh)}
            >
              <Ellipsis size={16} strokeWidth={1.75} />
            </IconButton>
          </div>
        </div>
      )}
    </li>
  )
}
