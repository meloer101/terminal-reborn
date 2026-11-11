// ⌘K's Git group (合入链路 v2, Figma 73H): the merge chain of the active session's worktree, read from the same stores
// Git · 变更 reads (asked again when the palette opens), as the actions that can run now. Null while there is nothing
// to offer (no worktree, a run already open, the state still unknown).
import { headlessAgent } from '@shared/agents'
import { useEffect, useState } from 'react'
import type { GitChanges } from '@shared/git-graph/log'
import { useGit } from '../panels/git/store'
import { primaryExitOf } from '../panels/merge/store'
import { chainPlace, chainPlanOf } from '../pull-requests/chain-actions'
import { loadPreflight, useChainStore } from '../pull-requests/chain-store'
import { paletteGitActions } from '../pull-requests/chain-zone'
import { useShips } from '../pull-requests/ship-runner'
import { usePullRequests } from '../pull-requests/store'
import { useBackgroundReview } from '../review/background'
import { useSettings } from '../settings/useSettings'
import { useWorkspace } from '../state/workspace'
import type { PaletteGit } from './entries'

export function useGitGroup(): PaletteGit | null {
  const sessionId = useWorkspace((s) => s.activeSessionId)
  const path = useWorkspace((s) => {
    const session = s.sessions.find((x) => x.id === s.activeSessionId)
    return s.worktrees.find((w) => w.id === session?.worktreeId && !w.archived)?.path ?? null
  })
  const kept = useGit((s) => (path ? s.roots[path] : undefined))
  const [fetched, setFetched] = useState<GitChanges | null>(null)
  const preflight = useChainStore((s) => (path ? (s.preflights[path] ?? null) : null))
  const prStatus = usePullRequests((s) => (s.gh === 'ready' && path ? (s.byWorktree[path] ?? null) : null))
  const shipping = useShips((s) => (path ? s.byWorktree[path] !== undefined : false))
  const reviewing = useBackgroundReview((s) => (path ? s.byRoot[path]?.phase === 'running' : false))
  const { settings } = useSettings()

  // Asked again on open: the palette acts on what is true now, not on what Git · 变更 saw last.
  useEffect(() => {
    if (!path) return
    const place = chainPlace(path)
    if (!place) return
    let live = true
    void loadPreflight({ root: place.project.rootPath, worktree: path })
    void window.tr.git
      .changes(path, place.worktree.baseBranch ?? undefined)
      .then((changes) => live && setFetched(changes))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [path])

  const changes = fetched ?? kept?.changes ?? null
  if (!path || !sessionId || !changes || !preflight || shipping) return null
  const place = chainPlace(path)
  if (!place) return null
  const { chain, ticked } = chainPlanOf(place, { preflight, changes, prStatus, unticked: kept?.unticked ?? new Set() })
  const agent = place.agent
  const reviewable = settings.review.mode === 'builtin' && headlessAgent(agent?.kind) !== null && !reviewing
  const files = new Set([...changes.uncommitted, ...changes.committed].map((c) => c.path)).size
  const actions = paletteGitActions(chain, {
    ticked: ticked.length,
    behind: preflight.ok ? preflight.behindBase : null,
    branch: preflight.ok ? preflight.branch : place.worktree.branch,
    remote: preflight.ok ? preflight.remote : null,
    reviewFiles: reviewable ? files : null,
    pr: prStatus?.pr && (prStatus.pr.state === 'open' || prStatus.pr.state === 'draft') ? prStatus.pr.number : null,
    exitRegistered: primaryExitOf(path) !== undefined,
    ...(preflight.ok && preflight.pullFrom !== undefined ? { pullFrom: preflight.pullFrom } : {})
  })
  if (actions.length === 0) return null
  return { name: preflight.ok ? preflight.branch : place.worktree.branch, worktreePath: path, sessionId, actions }
}
