// State of the Git view, kept per worktree root so switching sessions swaps it at once and switching back finds it
// as it was. The graph loads in pages (layout continues from the previous page's lane state); a cheap ref
// signature, checked on file changes and every few seconds, decides when to reload it — with as many commits as
// were loaded, so a reader deep in history stays there. 变更 reloads at most once a second while files change.
import { create } from 'zustand'
import { parseUnifiedDiff } from '@shared/git-graph/diff'
import { initialLaneState, layoutRows, type GraphRow, type LaneState } from '@shared/git-graph/lanes'
import {
  GRAPH_MAX_RELOAD,
  GRAPH_PAGE_SIZE,
  type GitChanges,
  type GitCommit,
  type GitFileChange,
  type GitLogPage,
  type GitLogScope
} from '@shared/git-graph/log'
import { changedSince, changeKey, noDiffReason, type ChangeGroup, type DiffView } from './changes-model'

export type GitTab = 'graph' | 'changes'

export interface GraphData {
  commits: GitCommit[]
  rows: GraphRow[]
  lanes: LaneState
  /** Graph width the text column is aligned to: the first page's widest row (a wider row later shifts only itself). */
  columns: number
  hasMore: boolean
  /** Refs, worktrees, HEAD, trunk and real paths of the first page. */
  meta: Omit<GitLogPage, 'commits' | 'hasMore'>
}

export interface RootGit {
  tab: GitTab
  scope: GitLogScope
  /** 全部分支 shows remote-tracking branches unless 隐藏远程分支 is on. */
  remotes: boolean
  /** undefined = loading the first page; null = not a git repo (or `graphError`). */
  graph: GraphData | null | undefined
  graphError: string | null
  loadingMore: boolean
  fetching: boolean
  fetchError: string | null
  /** undefined = not loaded yet; null = not a git repo (or `changesError`). */
  changes: GitChanges | null | undefined
  changesError: string | null
  /** Open files in 变更, as `${group}:${path}`. */
  expanded: ReadonlySet<string>
  diffs: Record<string, DiffView>
}

const EMPTY: RootGit = {
  tab: 'graph',
  scope: 'all',
  remotes: true,
  graph: undefined,
  graphError: null,
  loadingMore: false,
  fetching: false,
  fetchError: null,
  changes: undefined,
  changesError: null,
  expanded: new Set(),
  diffs: {}
}

export const useGit = create<{ roots: Record<string, RootGit> }>()(() => ({ roots: {} }))

export const gitOf = (root: string): RootGit => useGit.getState().roots[root] ?? EMPTY

function patch(root: string, update: Partial<RootGit> | ((current: RootGit) => Partial<RootGit>)): void {
  useGit.setState((s) => {
    const current = s.roots[root] ?? EMPTY
    return { roots: { ...s.roots, [root]: { ...current, ...(typeof update === 'function' ? update(current) : update) } } }
  })
}

const api = () => window.tr.git

/** Main's message without Electron's "Error invoking remote method 'git:…': Error: " wrapper. */
export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')
}

// --- graph ------------------------------------------------------------------------------------------------------

/** Bumped on every reload so answers to an older request are dropped. */
const generations = new Map<string, number>()
/** Workspace worktree paths of the root's project, sent along so main can resolve them. */
const knownPaths = new Map<string, string[]>()

function graphFrom(page: GitLogPage, previous?: GraphData): GraphData {
  const lanes = previous?.lanes ?? initialLaneState(page.trunk?.hash)
  const { rows, state } = layoutRows(page.commits, lanes)
  const { commits: _commits, hasMore, ...meta } = page
  return {
    commits: previous ? [...previous.commits, ...page.commits] : page.commits,
    rows: previous ? [...previous.rows, ...rows] : rows,
    lanes: state,
    columns: previous?.columns ?? Math.max(1, ...rows.slice(0, GRAPH_PAGE_SIZE).map((r) => r.width)),
    hasMore,
    meta: previous?.meta ?? meta
  }
}

/** (Re)loads the graph from the top, keeping at least as many commits as were loaded (plus `extra`). */
export async function loadGraph(root: string, options: { known?: string[]; extra?: number } = {}): Promise<void> {
  if (options.known) knownPaths.set(root, options.known)
  const generation = (generations.get(root) ?? 0) + 1
  generations.set(root, generation)
  const current = gitOf(root)
  const loaded = current.graph?.commits.length ?? 0
  const limit = Math.min(GRAPH_MAX_RELOAD, Math.max(GRAPH_PAGE_SIZE, loaded + (options.extra ?? 0)))
  try {
    const page = await api().log({
      root,
      skip: 0,
      limit,
      scope: current.scope,
      remotes: current.remotes,
      known: knownPaths.get(root) ?? []
    })
    if (generations.get(root) !== generation) return
    patch(root, { graph: page ? graphFrom(page) : null, graphError: null, loadingMore: false })
  } catch (error) {
    if (generations.get(root) !== generation) return
    patch(root, { graph: null, graphError: errorMessage(error), loadingMore: false })
  }
}

/** Next page, laid out from where the last one stopped. */
export async function loadMore(root: string): Promise<void> {
  const current = gitOf(root)
  if (!current.graph?.hasMore || current.loadingMore) return
  const generation = generations.get(root) ?? 0
  patch(root, { loadingMore: true })
  try {
    const page = await api().log({
      root,
      skip: current.graph.commits.length,
      limit: GRAPH_PAGE_SIZE,
      scope: current.scope,
      remotes: current.remotes,
      known: knownPaths.get(root) ?? []
    })
    if (generations.get(root) !== generation) return
    const graph = gitOf(root).graph
    // Refs moved since the first page: the pages no longer line up. Reload everything plus the page asked for.
    if (!page || !graph || page.signature !== graph.meta.signature) return void loadGraph(root, { extra: GRAPH_PAGE_SIZE })
    patch(root, { graph: graphFrom(page, graph), loadingMore: false })
  } catch {
    if (generations.get(root) === generation) patch(root, { loadingMore: false })
  }
}

/** Reloads the graph (and the changes) when a ref or worktree HEAD moved. */
export async function checkForUpdates(root: string): Promise<void> {
  const graph = gitOf(root).graph
  if (graph === undefined) return
  const signature = await api()
    .signature(root)
    .catch(() => '')
  if (signature === (graph?.meta.signature ?? '')) return
  void loadGraph(root)
  scheduleChanges(root)
}

export function setScope(root: string, scope: GitLogScope): void {
  if (gitOf(root).scope === scope) return
  patch(root, { scope, graph: undefined })
  void loadGraph(root)
}

export function setRemotes(root: string, remotes: boolean): void {
  if (gitOf(root).remotes === remotes) return
  patch(root, { remotes, graph: undefined })
  void loadGraph(root)
}

export const setTab = (root: string, tab: GitTab): void => patch(root, { tab })

export async function fetchRemotes(root: string): Promise<void> {
  if (gitOf(root).fetching) return
  patch(root, { fetching: true, fetchError: null })
  const error = await api()
    .fetch(root)
    .catch(errorMessage)
  patch(root, { fetching: false, fetchError: error || null })
  void checkForUpdates(root)
}

// --- changes ----------------------------------------------------------------------------------------------------

/** 变更 reloads at most this often while files keep changing (trailing). */
const CHANGES_THROTTLE_MS = 1000

const bases = new Map<string, string | undefined>()
const changeRuns = new Map<string, { running: boolean; again: boolean }>()
const changeTimers = new Map<string, number>()

/** Reloads 未提交 / 已提交; one run at a time per root, a request while one runs schedules one more. */
export async function loadChanges(root: string, options?: { base: string | undefined }): Promise<void> {
  if (options) bases.set(root, options.base)
  const run = changeRuns.get(root) ?? { running: false, again: false }
  changeRuns.set(root, run)
  if (run.running) {
    run.again = true
    return
  }
  run.running = true
  try {
    do {
      run.again = false
      const before = gitOf(root).changes
      try {
        const changes = await api().changes(root, bases.get(root))
        patch(root, { changes, changesError: null })
        refreshOpenDiffs(root, before ?? null)
      } catch (error) {
        patch(root, { changes: null, changesError: errorMessage(error) })
      }
    } while (run.again)
  } finally {
    run.running = false
  }
}

/** A reload of 变更 within CHANGES_THROTTLE_MS (watcher ticks come every 250 ms while an agent writes). */
export function scheduleChanges(root: string): void {
  if (changeTimers.has(root)) return
  changeTimers.set(
    root,
    window.setTimeout(() => {
      changeTimers.delete(root)
      void loadChanges(root)
    }, CHANGES_THROTTLE_MS)
  )
}

function changeFor(changes: GitChanges | null | undefined, key: string): { group: ChangeGroup; change: GitFileChange } | null {
  if (!changes) return null
  for (const group of ['uncommitted', 'committed'] as const) {
    const change = changes[group].find((c) => changeKey(group, c.path) === key)
    if (change) return { group, change }
  }
  return null
}

async function loadDiff(root: string, key: string): Promise<void> {
  const changes = gitOf(root).changes
  const found = changeFor(changes, key)
  if (!found || !changes || noDiffReason(found.change)) return
  const { group, change } = found
  try {
    const text = await api().fileDiff({
      root,
      path: change.path,
      ...(change.oldPath ? { oldPath: change.oldPath } : {}),
      scope: group,
      ...(group === 'committed' && changes.baseRef ? { baseRef: changes.baseRef } : {}),
      untracked: change.untracked === true
    })
    const { rows, binary, truncated } = parseUnifiedDiff(text)
    patch(root, (c) => ({ diffs: { ...c.diffs, [key]: { kind: 'ready', rows, binary, truncated } } }))
  } catch {
    patch(root, (c) => ({ diffs: { ...c.diffs, [key]: { kind: 'error' } } }))
  }
}

export function toggleFile(root: string, key: string): void {
  const c = gitOf(root)
  const expanded = new Set(c.expanded)
  if (expanded.delete(key)) return patch(root, { expanded })
  expanded.add(key)
  patch(root, (current) => ({ expanded, diffs: { ...current.diffs, [key]: current.diffs[key] ?? { kind: 'loading' } } }))
  void loadDiff(root, key)
}

/** 全部收起 (the Git pane's ⋯ menu): every open file folds. */
export function collapseAll(root: string): void {
  if (gitOf(root).expanded.size > 0) patch(root, { expanded: new Set() })
}

/** After the lists reload: forget files that are gone, refetch only the open diffs whose file changed. */
function refreshOpenDiffs(root: string, before: GitChanges | null): void {
  const c = gitOf(root)
  const expanded = new Set([...c.expanded].filter((key) => changeFor(c.changes, key)))
  const diffs = Object.fromEntries(Object.entries(c.diffs).filter(([key]) => expanded.has(key)))
  patch(root, { expanded, diffs })
  for (const key of expanded) {
    const now = changeFor(c.changes, key)
    const was = changeFor(before, key)
    // Committed diffs also move with the base.
    if (now && (changedSince(was?.change, now.change) || before?.baseRef !== c.changes?.baseRef)) void loadDiff(root, key)
  }
}

// --- watching ---------------------------------------------------------------------------------------------------

// Main reports file changes for roots this window watches (GitView starts and stops the watch).
let listening = false
export function listenForChanges(): void {
  if (listening) return
  listening = true
  window.tr.worktree.onChanged((change) => {
    if (!useGit.getState().roots[change.root]) return
    // An install or a rebuild writing node_modules / .next changes nothing git reports (WorktreeChange.code).
    if (change.code || change.git) scheduleChanges(change.root)
    if (change.git) void checkForUpdates(change.root)
  })
}

/** Whether git is installed; asked once per app run. */
let gitInstalled: Promise<boolean> | null = null
export const gitAvailable = (): Promise<boolean> => (gitInstalled ??= api().available().catch(() => false))
