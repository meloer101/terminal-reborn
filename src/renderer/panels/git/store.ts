// State of the Git view, kept per worktree root so switching sessions swaps it at once and switching back finds it
// as it was. The graph loads in pages (layout continues from the previous page's lane state); a cheap ref
// signature, checked on file changes and every few seconds, decides when to reload it.
import { create } from 'zustand'
import { parseUnifiedDiff, type ParsedDiff } from '@shared/git-graph/diff'
import { initialLaneState, layoutRows, type GraphRow, type LaneState } from '@shared/git-graph/lanes'
import {
  GRAPH_MAX_PAGE_SIZE,
  GRAPH_PAGE_SIZE,
  type GitChanges,
  type GitCommit,
  type GitFileChange,
  type GitLogPage,
  type GitLogScope
} from '@shared/git-graph/log'

export type GitTab = 'graph' | 'changes'
export type ChangeGroup = 'uncommitted' | 'committed'

export interface GraphData {
  commits: GitCommit[]
  rows: GraphRow[]
  lanes: LaneState
  /** Widest row so far, in columns. */
  columns: number
  hasMore: boolean
  /** Refs, worktrees, HEAD, trunk and real paths of the first page. */
  meta: Omit<GitLogPage, 'commits' | 'hasMore'>
}

export type DiffState = { kind: 'loading' } | { kind: 'ready'; diff: ParsedDiff } | { kind: 'error'; message: string }

export interface RootGit {
  tab: GitTab
  scope: GitLogScope
  /** undefined = loading the first page; null = not a git repo. */
  graph: GraphData | null | undefined
  graphError: string | null
  loadingMore: boolean
  fetching: boolean
  fetchError: string | null
  /** undefined = not loaded yet; null = not a git repo. */
  changes: GitChanges | null | undefined
  /** Open files in 变更, as `${group}:${path}`. */
  expanded: ReadonlySet<string>
  diffs: Record<string, DiffState>
}

const EMPTY: RootGit = {
  tab: 'graph',
  scope: 'all',
  graph: undefined,
  graphError: null,
  loadingMore: false,
  fetching: false,
  fetchError: null,
  changes: undefined,
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
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

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
    columns: Math.max(previous?.columns ?? 1, ...rows.map((r) => r.width)),
    hasMore,
    meta: previous?.meta ?? meta
  }
}

/** (Re)loads the graph from the top, keeping as many commits as were loaded before. */
export async function loadGraph(root: string, known?: string[]): Promise<void> {
  if (known) knownPaths.set(root, known)
  const generation = (generations.get(root) ?? 0) + 1
  generations.set(root, generation)
  const current = gitOf(root)
  const limit = Math.min(GRAPH_MAX_PAGE_SIZE, Math.max(GRAPH_PAGE_SIZE, current.graph?.commits.length ?? 0))
  try {
    const page = await api().log({ root, skip: 0, limit, scope: current.scope, known: knownPaths.get(root) ?? [] })
    if (generations.get(root) !== generation) return
    patch(root, { graph: page ? graphFrom(page) : null, graphError: null, loadingMore: false })
  } catch (error) {
    if (generations.get(root) !== generation) return
    patch(root, { graph: null, graphError: message(error), loadingMore: false })
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
      known: knownPaths.get(root) ?? []
    })
    if (generations.get(root) !== generation) return
    const graph = gitOf(root).graph
    // Refs moved since the first page: the pages no longer line up, start over.
    if (!page || !graph || page.signature !== graph.meta.signature) return void loadGraph(root)
    patch(root, { graph: graphFrom(page, graph), loadingMore: false })
  } catch {
    if (generations.get(root) === generation) patch(root, { loadingMore: false })
  }
}

/** Reloads the graph (and the changes) when a ref or worktree HEAD moved. */
export async function checkForUpdates(root: string): Promise<void> {
  const graph = gitOf(root).graph
  if (graph === undefined) return
  const signature = await api().signature(root).catch(() => '')
  if (signature === (graph?.meta.signature ?? '')) return
  void loadGraph(root)
  void loadChanges(root)
}

export function setScope(root: string, scope: GitLogScope): void {
  if (gitOf(root).scope === scope) return
  patch(root, { scope, graph: undefined })
  void loadGraph(root)
}

export const setTab = (root: string, tab: GitTab): void => patch(root, { tab })

export async function fetchRemotes(root: string): Promise<void> {
  if (gitOf(root).fetching) return
  patch(root, { fetching: true, fetchError: null })
  const error = await api().fetch(root).catch(message)
  patch(root, { fetching: false, fetchError: error || null })
  void checkForUpdates(root)
}

// --- changes ----------------------------------------------------------------------------------------------------

const bases = new Map<string, string | undefined>()
const changeRuns = new Map<string, { running: boolean; again: boolean }>()

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
      const changes = await api()
        .changes(root, bases.get(root))
        .catch(() => null)
      patch(root, { changes })
      refreshOpenDiffs(root)
    } while (run.again)
  } finally {
    run.running = false
  }
}

export const changeKey = (group: ChangeGroup, path: string) => `${group}:${path}`

function changeFor(root: string, key: string): { group: ChangeGroup; change: GitFileChange } | null {
  const changes = gitOf(root).changes
  if (!changes) return null
  for (const group of ['uncommitted', 'committed'] as const) {
    const change = changes[group].find((c) => changeKey(group, c.path) === key)
    if (change) return { group, change }
  }
  return null
}

async function loadDiff(root: string, key: string): Promise<void> {
  const found = changeFor(root, key)
  const changes = gitOf(root).changes
  if (!found || !changes) return
  const { group, change } = found
  try {
    const text = await api().fileDiff({
      root,
      path: change.path,
      ...(change.oldPath ? { oldPath: change.oldPath } : {}),
      scope: group,
      ...(group === 'committed' && changes.base ? { base: changes.base } : {}),
      untracked: change.untracked === true
    })
    patch(root, (c) => ({ diffs: { ...c.diffs, [key]: { kind: 'ready', diff: parseUnifiedDiff(text) } } }))
  } catch (error) {
    patch(root, (c) => ({ diffs: { ...c.diffs, [key]: { kind: 'error', message: message(error) } } }))
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

/** After the file lists change, reload the diffs that are open and forget files that are gone. */
function refreshOpenDiffs(root: string): void {
  const c = gitOf(root)
  const expanded = new Set([...c.expanded].filter((key) => changeFor(root, key)))
  const diffs = Object.fromEntries(Object.entries(c.diffs).filter(([key]) => expanded.has(key)))
  patch(root, { expanded, diffs })
  for (const key of expanded) void loadDiff(root, key)
}

// --- watching ---------------------------------------------------------------------------------------------------

// Main reports file changes for roots this window watches (GitView starts and stops the watch).
let listening = false
export function listenForChanges(): void {
  if (listening) return
  listening = true
  window.tr.worktree.onChanged((change) => {
    if (!useGit.getState().roots[change.root]) return
    void loadChanges(change.root)
    if (change.git) void checkForUpdates(change.root)
  })
}
