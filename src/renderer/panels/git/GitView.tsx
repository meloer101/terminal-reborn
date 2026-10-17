// Git view (PRD F17 Git · 图谱 / 变更, Figma 13B / 13H / 13B2): header, the 图谱 / 变更 switch, and either the commit
// graph of the whole repo or the active worktree's changes.
import { ChevronDown, Ellipsis, RotateCw } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { compareByUrgency } from '@shared/session-status'
import type { GitLogScope } from '@shared/git-graph/log'
import type { Worktree } from '@shared/types'
import { glyphStatus } from '../../lifecycle/present'
import { useWorkspace } from '../../state/workspace'
import { IconButton } from '../../ui/IconButton'
import { popupMenu } from '../../ui/menu'
import { PaneHeader } from '../PaneHeader'
import { ChangesView } from './ChangesView'
import { GraphView } from './GraphView'
import type { SessionsByPath } from './graph-model'
import { checkForUpdates, fetchRemotes, gitOf, listenForChanges, loadChanges, loadGraph, setScope, setTab, useGit } from './store'
import styles from './GitView.module.css'

/** How often the graph checks whether a ref moved while it is on screen (linked worktrees' refs are not watched). */
const POLL_MS = 4000

const SCOPE_LABEL: Record<GitLogScope, string> = { all: '全部分支', worktrees: '仅 worktree' }

export function GitView({ worktree }: { worktree: Worktree }) {
  const root = worktree.path
  const git = useGit((s) => s.roots[root]) ?? gitOf(root)
  const projectName = useWorkspace((s) => s.projects.find((p) => p.id === worktree.projectId)?.name ?? '')
  // Every workspace worktree of this project, with its most urgent session.
  const projectWorktrees = useWorkspace(
    useShallow((s) => s.worktrees.filter((w) => w.projectId === worktree.projectId).map((w) => w.path))
  )
  const sessionList = useWorkspace((s) => s.sessions)
  const worktreeList = useWorkspace((s) => s.worktrees)
  const knownKey = projectWorktrees.join('\0')

  useEffect(() => {
    listenForChanges()
    void loadGraph(root, knownKey ? knownKey.split('\0') : [])
    window.tr.worktree.watch(root)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void checkForUpdates(root)
    }, POLL_MS)
    return () => {
      window.clearInterval(timer)
      window.tr.worktree.unwatch(root)
    }
  }, [root, knownKey])

  useEffect(() => {
    void loadChanges(root, { base: worktree.baseBranch })
  }, [root, worktree.baseBranch])

  const realPaths = git.graph?.meta.realPaths
  const sessions = useMemo((): SessionsByPath => {
    const byPath = new Map<string, { sessionId: string; status: ReturnType<typeof glyphStatus> }>()
    for (const w of worktreeList) {
      if (w.projectId !== worktree.projectId) continue
      const [first] = sessionList.filter((s) => s.worktreeId === w.id).sort(compareByUrgency)
      if (first) byPath.set(realPaths?.[w.path] ?? w.path, { sessionId: first.id, status: glyphStatus(first) })
    }
    return byPath
  }, [worktreeList, sessionList, worktree.projectId, realPaths])

  const changeCount = git.changes ? new Set([...git.changes.uncommitted, ...git.changes.committed].map((c) => c.path)).size : null
  const onGraph = git.tab === 'graph'

  return (
    <>
      <PaneHeader title="Git" context={onGraph ? projectName : (git.changes?.branch ?? worktree.branch)}>
        {onGraph && (
          <IconButton
            label={git.fetching ? '正在拉取…' : '拉取（fetch）'}
            disabled={git.fetching}
            onClick={() => void fetchRemotes(root)}
          >
            <RotateCw size={16} strokeWidth={1.75} className={git.fetching ? styles.spinning : undefined} />
          </IconButton>
        )}
        <IconButton
          label="更多"
          aria-haspopup="menu"
          onClick={(e) => {
            void popupMenu([{ type: 'item', id: 'refresh', label: '刷新' }], e.currentTarget).then((choice) => {
              if (choice !== 'refresh') return
              void loadGraph(root)
              void loadChanges(root)
            })
          }}
        >
          <Ellipsis size={16} strokeWidth={1.75} />
        </IconButton>
      </PaneHeader>
      <div className={styles.viewRow}>
        <div role="tablist" aria-label="Git 视图" className={styles.segments}>
          <button type="button" role="tab" aria-selected={onGraph} className={styles.segment} onClick={() => setTab(root, 'graph')}>
            图谱
          </button>
          <button type="button" role="tab" aria-selected={!onGraph} className={styles.segment} onClick={() => setTab(root, 'changes')}>
            变更{changeCount === null ? '' : ` ${changeCount}`}
          </button>
        </div>
        <span className={styles.spacer} />
        {onGraph ? (
          <button
            type="button"
            className={styles.filter}
            aria-haspopup="menu"
            onClick={(e) => {
              void popupMenu(
                (['all', 'worktrees'] as const).map((scope) => ({ type: 'item' as const, id: scope, label: SCOPE_LABEL[scope] })),
                e.currentTarget
              ).then((choice) => {
                if (choice === 'all' || choice === 'worktrees') setScope(root, choice)
              })
            }}
          >
            {SCOPE_LABEL[git.scope]}
            <ChevronDown size={16} strokeWidth={1.75} />
          </button>
        ) : (
          git.changes?.base && (
            <span className={styles.aheadBehind}>
              领先 {git.changes.ahead} · 落后 {git.changes.behind}
            </span>
          )
        )}
      </div>
      {git.fetchError && onGraph && (
        <p className={styles.notice} title={git.fetchError}>
          拉取失败：{git.fetchError.split('\n')[0]}
        </p>
      )}
      {onGraph ? <GraphView root={root} git={git} sessions={sessions} /> : <ChangesView root={root} git={git} />}
    </>
  )
}
