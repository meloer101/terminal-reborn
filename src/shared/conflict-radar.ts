// Conflict radar (ROADMAP 多 agent 第二批): which active worktrees of a repository would conflict with each other or
// with their base if they landed as they are now, and which ones a merge into the base left behind. Main runs
// `git merge-tree --write-tree` (the merge precheck's in-memory merge, PRD F4) on every pair and against the base,
// in the background and only when something changed; nothing here costs tokens or touches a working tree or index.
// This file holds the IPC contract, payload validation and the pure parts: what to (re)check, what a merge into the
// base did to the others, and what the window shows.
import type { MergeConflict } from './git-merge'

export const RADAR_IPC = {
  /** send(RadarTarget[]): the worktrees this window shows (replaces its earlier list) */
  watch: 'radar:watch',
  /** invoke → RadarReport[] for the roots this window watches */
  reports: 'radar:reports',
  /** main → renderer, payload RadarReport */
  report: 'radar:report'
} as const

export interface RadarTarget {
  /** The workspace project root (main refuses anything else). */
  root: string
  /** The worktree's path as the workspace has it; reports use the same string. */
  worktree: string
  /**
   * Changes when the worktree's uncommitted files may have changed (the latest turn end of its sessions, epoch ms;
   * 0 when none ended yet). Main snapshots uncommitted work only then, on HEAD changes and on window focus.
   */
  stamp: number
}

/** One worktree with work of its own (commits ahead of its base, or uncommitted changes). */
export interface RadarWorktree {
  worktree: string
  branch: string
  base: string
  /** Commits on the branch the base lacks / on the base the branch lacks. */
  ahead: number
  behind: number
  /** Uncommitted changes (tracked edits, small untracked files) were part of the check. */
  uncommitted: boolean
  /** Files that would conflict if this worktree's work landed on the base now. */
  baseConflicts: MergeConflict[]
  /** The base moved while Wavi watched (another worktree was merged, a pull) and this branch is behind it. */
  baseMoved: boolean
}

/** Two worktrees whose work would conflict; only conflicting pairs are reported. `a` < `b`. */
export interface RadarPair {
  a: string
  b: string
  conflicts: MergeConflict[]
}

export interface RadarReport {
  root: string
  /** 'unsupported': git is older than 2.38 (no `merge-tree --write-tree`); the window shows nothing. */
  state: 'ok' | 'unsupported'
  worktrees: RadarWorktree[]
  pairs: RadarPair[]
  checkedAt: number
}

export interface ConflictRadarApi {
  watch(targets: RadarTarget[]): void
  reports(): Promise<RadarReport[]>
  onReport(listener: (report: RadarReport) => void): () => void
}

// ── validation ──────────────────────────────────────────────────────────────────────────────────────────────────

const MAX_PATH = 4096
const MAX_TARGETS = 1000

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH && !value.includes('\0') && value.startsWith('/')

/** Validates the watch list from the renderer; null when anything is off. */
export function parseRadarTargets(raw: unknown): RadarTarget[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_TARGETS) return null
  const targets: RadarTarget[] = []
  for (const item of raw) {
    if (!isRecord(item) || !isPath(item.root) || !isPath(item.worktree)) return null
    const stamp = typeof item.stamp === 'number' && Number.isFinite(item.stamp) && item.stamp >= 0 ? item.stamp : 0
    targets.push({ root: item.root, worktree: item.worktree, stamp })
  }
  return targets
}

// ── what to check ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A worktree as the planner sees it: `commit` is what merges (HEAD, or a snapshot commit of HEAD plus uncommitted
 * work), `baseHead` the base's commit. Equal commits give equal answers, so results are cached by them.
 */
export interface RadarNode {
  worktree: string
  commit: string
  baseHead: string
}

export type RadarJob = { kind: 'pair'; a: string; b: string; key: string } | { kind: 'base'; worktree: string; key: string }

/** The cache key of merging two commits (order does not matter). */
export function pairKey(x: string, y: string): string {
  return x < y ? `${x}:${y}` : `${y}:${x}`
}

/**
 * Every merge the report needs — each node against its base and every pair of nodes (n·(n−1)/2) — with its cache
 * key, and which of them still have to run. Pairs are ordered by worktree path so a report is stable.
 */
export function planRadar(nodes: readonly RadarNode[], cached: (key: string) => boolean): { jobs: RadarJob[]; missing: RadarJob[] } {
  const sorted = [...nodes].sort((x, y) => (x.worktree < y.worktree ? -1 : x.worktree > y.worktree ? 1 : 0))
  const jobs: RadarJob[] = []
  for (const node of sorted) jobs.push({ kind: 'base', worktree: node.worktree, key: pairKey(node.baseHead, node.commit) })
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!
      const b = sorted[j]!
      // The same commit twice (two worktrees on one branch cannot happen; a snapshot equal to another can) is clean.
      if (a.commit === b.commit) continue
      jobs.push({ kind: 'pair', a: a.worktree, b: b.worktree, key: pairKey(a.commit, b.commit) })
    }
  }
  return { jobs, missing: jobs.filter((job) => !cached(job.key)) }
}

// ── the base moving ─────────────────────────────────────────────────────────────────────────────────────────────

/** Per worktree: the base commit it was level with (or first seen at), and whether the base has moved past it. */
export interface BaseTrack {
  level: string
  moved: boolean
}

/**
 * After a check: a branch level with its base (behind 0) starts over; one that is behind and whose base is no longer
 * where it was first seen / last level has been left behind by a merge (or a pull) — until it catches up.
 * A branch already behind when first seen is not flagged: nothing happened while Wavi watched.
 */
export function trackBase(previous: BaseTrack | undefined, baseHead: string, behind: number): BaseTrack {
  if (!previous || behind === 0) return { level: baseHead, moved: false }
  if (previous.moved || previous.level !== baseHead) return { level: previous.level, moved: true }
  return previous
}

// ── what the window shows ───────────────────────────────────────────────────────────────────────────────────────

/** A worktree's mark in the overview and the Worktree view. */
export interface RadarMark {
  /** conflict: would conflict with another worktree or the base · behind: the base moved past it (no conflict). */
  tone: 'conflict' | 'behind'
  /** One short line: "和 jacob/otter 会冲突" · "和 main 会冲突" · "main 已前进 · 落后 3". */
  label: string
  /** Everything, one item per line, for the hover. */
  detail: string
  /** Conflicting worktrees (paths) with their files, then the base's own conflicts. */
  pairs: { worktree: string; name: string; conflicts: MergeConflict[] }[]
  self: RadarWorktree
}

const MAX_DETAIL_FILES = 8

function fileList(conflicts: readonly MergeConflict[]): string {
  const shown = conflicts.slice(0, MAX_DETAIL_FILES).map((c) => c.path)
  const more = conflicts.length > shown.length ? ` 等 ${conflicts.length} 个文件` : ''
  return `${shown.join('、')}${more}`
}

/**
 * The mark of `worktree` in `report`, or null when there is nothing to say. `nameOf` names the other worktrees
 * (their branches). A conflict with another worktree comes first; then one with the base; then a base that moved.
 */
export function radarMark(report: RadarReport | undefined, worktree: string, nameOf: (worktree: string) => string): RadarMark | null {
  if (!report || report.state !== 'ok') return null
  const self = report.worktrees.find((w) => w.worktree === worktree)
  if (!self) return null
  const pairs = report.pairs
    .filter((p) => p.a === worktree || p.b === worktree)
    .map((p) => {
      const other = p.a === worktree ? p.b : p.a
      return { worktree: other, name: nameOf(other), conflicts: p.conflicts }
    })
  const lines: string[] = []
  for (const pair of pairs) lines.push(`和 ${pair.name} 会冲突：${fileList(pair.conflicts)}`)
  if (self.baseConflicts.length > 0) lines.push(`合并到 ${self.base} 会冲突：${fileList(self.baseConflicts)}`)
  if (self.behind > 0 && (self.baseMoved || self.baseConflicts.length > 0)) {
    lines.push(`${self.base} 已前进，${self.branch} 落后 ${self.behind} 个提交`)
  }
  if (lines.length > 0 && self.uncommitted) lines.push('含未提交的改动')

  let label: string
  let tone: RadarMark['tone'] = 'conflict'
  if (pairs.length > 0) label = pairs.length === 1 ? `和 ${pairs[0]!.name} 会冲突` : `和 ${pairs[0]!.name} 等 ${pairs.length} 个会冲突`
  else if (self.baseConflicts.length > 0) label = `和 ${self.base} 会冲突`
  else if (self.baseMoved && self.behind > 0) {
    tone = 'behind'
    label = `${self.base} 已前进 · 落后 ${self.behind}`
  } else return null
  return { tone, label, detail: lines.join('\n'), pairs, self }
}

/** Whether 让 agent rebase applies: the base moved past the branch, or landing on it would conflict. */
export function wantsRebase(self: RadarWorktree): boolean {
  return self.behind > 0 && (self.baseMoved || self.baseConflicts.length > 0)
}
