// Worktree view (PRD F17, Figma 13C `149:5973`): every git worktree of the active session's project with the status
// of its sessions, uncommitted stats and ahead / behind; the selected row expands into details and actions, and
// merged or session-less worktrees sit in 可清理. Refreshes on window focus and whenever the sessions change.
import { Ellipsis, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { ProjectId, WorktreeId } from '@shared/types'
import { openNewSessionMenu } from '../../state/session-actions'
import { useWorkspace } from '../../state/workspace'
import { IconButton } from '../../ui/IconButton'
import { StatusGlyph } from '../../ui/StatusGlyph'
import { PaneHeader } from '../PaneHeader'
import { cleanUpInteractive, openRowMenu, selectRow } from './actions'
import { buildRows, detailLines, selectedRow, tildePath, type WorktreeRow } from './model'
import { patchRoot, refreshWorktrees, useWorktrees, worktreesOf } from './store'
import styles from './WorktreeView.module.css'

/** Session changes (new, closed, status) come in bursts; list once they settle. */
const SESSION_REFRESH_DELAY_MS = 400

interface Props {
  projectId: ProjectId
  /** The project's main checkout. */
  root: string
  projectName: string
  activeWorktreeId: WorktreeId | null
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
  const refresh = useCallback(() => refreshWorktrees(root, knownPaths), [root, knownPaths])

  // What makes the list stale: sessions opening, closing or changing state (an agent finishing a turn commits).
  const sessionKey = sessions.map((s) => `${s.id}:${s.worktreeId}:${s.status}`).join('|')
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), worktreesOf(root).listing === undefined ? 0 : SESSION_REFRESH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [root, refresh, sessionKey])
  useEffect(() => {
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  // Switching sessions anywhere else moves the selection to the new session's worktree.
  useEffect(() => patchRoot(root, { picked: null }), [root, activeWorktreeId])

  const groups = useMemo(() => (state.listing ? buildRows(state.listing, worktrees, sessions) : null), [state.listing, worktrees, sessions])
  const selected = groups ? selectedRow([...groups.working, ...groups.cleanable], state.picked, activeWorktreeId) : null

  const empty =
    state.listing === undefined ? '正在读取 worktree…' : state.listing === null ? (state.failed ? '无法读取 worktree' : '不是 git 仓库') : null

  return (
    <>
      <PaneHeader title="Worktree" context={projectName}>
        <IconButton
          label="新建会话"
          title="新建会话 · ⌘N"
          aria-haspopup="menu"
          onClick={(e) => void openNewSessionMenu(projectId, e.currentTarget)}
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
              <Row key={row.key} row={row} selected={row === selected} projectId={projectId} root={root} refresh={refresh} />
            ))}
          </ul>
          {groups.cleanable.length > 0 && (
            <section aria-label="可清理">
              <div className={styles.groupHeader}>
                <h3 className={styles.groupTitle}>可清理</h3>
                <span className={styles.groupHint}>已合并或没有会话</span>
                <button
                  type="button"
                  className={styles.ghost}
                  disabled={state.busy}
                  onClick={() => void cleanUpInteractive(root, groups.cleanable, refresh)}
                >
                  清理
                </button>
              </div>
              <ul className={styles.list} aria-label="可清理">
                {groups.cleanable.map((row) => (
                  <Row key={row.key} row={row} selected={row === selected} projectId={projectId} root={root} refresh={refresh} />
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
          <span className={styles.path}>{tildePath(row.openPath, window.tr.homeDir)}</span>
        </span>
      </button>
      {selected && (
        <div className={styles.details}>
          <dl className={styles.kv}>
            {detailLines(info).map((line) => (
              <div key={line.label} className={styles.kvRow}>
                <dt className={styles.kvLabel}>{line.label}</dt>
                <dd className={styles.kvValue}>{line.value}</dd>
              </div>
            ))}
          </dl>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.ghost}
              disabled={info.prunable}
              onClick={() => window.tr.worktree.reveal(info.path, '')}
            >
              打开文件夹
            </button>
            {info.base && (
              // Local merge is F4; until then the button only says where it will be.
              <button type="button" className={styles.ghost} aria-disabled="true" title="本地合并还没有做好（F4）">
                合并到 {info.base}…<span className={styles.shortcut}>⌘M</span>
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
