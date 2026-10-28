// What the review block at the top of Git · 变更 says (PRD F13 v1.78, Figma 29B2): the header, the counts, the
// reviewer's summary and one row per finding. Pure; the component only draws it.
import { commentPicked, type ReviewComment, type ReviewSeverity } from '@shared/review-comments'
import { reviewerLabel, type ReviewAgent, type ReviewStatus } from '@shared/background-review'

/** The part of a worktree's review state the block reads (background.ts keeps more). */
export type BlockStatus = Pick<ReviewStatus, 'phase' | 'agent' | 'message' | 'reviewer' | 'fileCount' | 'segment' | 'hidden'> & { found?: number }

export interface FindingRow {
  id: string
  /** Included in 发给 …. */
  picked: boolean
  severity: ReviewSeverity | null
  /** P0 / P1 take the attention colour; P2 / P3 are an outline. */
  tone: 'attention' | 'quiet'
  /** `file:line` as shown (a long path is shortened). */
  location: string
  /** The full path and line, for the tooltip. */
  locationTitle: string
  /** The finding's one-line title (the first line of its text). */
  title: string
}

export type BlockView =
  | { kind: 'running'; text: string }
  | { kind: 'failed'; text: string }
  | {
      kind: 'done'
      header: string
      /** Shown only when there are no rows (没有发现问题); with rows the P tags carry the severities. */
      counts: string
      /** 另有 N 条你之前忽略过, or ''. */
      ignored: string
      summary: string
      rows: FindingRow[]
      picked: number
    }

const SEVERITIES: readonly ReviewSeverity[] = ['P0', 'P1', 'P2', 'P3']
const SEVERITY_ORDER: Record<ReviewSeverity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }
/** Paths longer than this keep their last two segments. */
const MAX_PATH_CHARS = 28

/** "1 个 P1 · 1 个 P2": the severities that have findings, most severe first. Each count is spaced from its label. */
export function countsText(findings: readonly Pick<ReviewComment, 'severity'>[]): string {
  return SEVERITIES.map((severity) => [severity, findings.filter((f) => f.severity === severity).length] as const)
    .filter(([, n]) => n > 0)
    .map(([severity, n]) => `${n} 个 ${severity}`)
    .join(' · ')
}

/** "src/auth.ts" stays; "src/renderer/panels/git/ChangesView.tsx" becomes "…/git/ChangesView.tsx". */
export function shortPath(path: string): string {
  if (path.length <= MAX_PATH_CHARS) return path
  const parts = path.split('/')
  if (parts.length <= 2) return path
  return `…/${parts.slice(-2).join('/')}`
}

/** "Codex 审阅 · 3 个文件" (Figma 29R); without a file count (a result saved by an older version) just "Codex 审阅". */
export function headerText(status: Pick<BlockStatus, 'agent' | 'reviewer' | 'fileCount'>): string {
  const who = `${status.reviewer || reviewerLabel(status.agent)} 审阅`
  return status.fileCount !== undefined && status.fileCount > 0 ? `${who} · ${status.fileCount} 个文件` : who
}

/** P0 first, then by file and line. */
export function sortFindings(findings: readonly ReviewComment[]): ReviewComment[] {
  const rank = (c: ReviewComment): number => (c.severity ? SEVERITY_ORDER[c.severity] : SEVERITIES.length)
  return [...findings].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path) || a.line - b.line || a.createdAt - b.createdAt)
}

export function findingRow(comment: ReviewComment): FindingRow {
  const severity = comment.severity ?? null
  return {
    id: comment.id,
    picked: commentPicked(comment),
    severity,
    tone: severity === 'P0' || severity === 'P1' ? 'attention' : 'quiet',
    location: `${shortPath(comment.path)}:${comment.line}`,
    locationTitle: `${comment.path}:${comment.endLine > comment.line ? `${comment.line}-${comment.endLine}` : comment.line}`,
    title: (comment.text.split('\n')[0] ?? '').trim()
  }
}

/** The right half of the first row once the review is done. */
function doneCounts(status: BlockStatus, findings: readonly ReviewComment[]): string {
  const counts = countsText(findings)
  const ignored = status.hidden ? `另有 ${status.hidden} 条你之前忽略过` : ''
  if (counts) return ignored ? `${counts} · ${ignored}` : counts
  // Nothing left to show: either the review found nothing, or its findings were sent on.
  if ((status.found ?? 0) === 0) return ignored ? `没有发现问题 · ${ignored}` : '没有发现问题'
  return ignored
}

/**
 * The block for a worktree's latest review and the findings in its comment store (`origin: 'review'`), or null when
 * there is nothing to show: no review yet, one that was cancelled, or one that was skipped.
 */
export function reviewBlockView(status: BlockStatus | undefined, findings: readonly ReviewComment[]): BlockView | null {
  if (!status) return null
  if (status.phase === 'running') {
    const segment = status.segment && status.segment.count > 1 ? ` ${status.segment.index + 1}/${status.segment.count}` : ''
    return { kind: 'running', text: `审阅中…${segment}` }
  }
  if (status.phase === 'failed') return { kind: 'failed', text: status.message.startsWith('审阅失败') ? status.message : `审阅失败：${status.message}` }
  if (status.phase !== 'done') return null
  const rows = sortFindings(findings).map(findingRow)
  return {
    kind: 'done',
    header: headerText(status),
    counts: doneCounts(status, findings),
    ignored: status.hidden ? `另有 ${status.hidden} 条你之前忽略过` : '',
    summary: status.message.trim(),
    rows,
    picked: rows.filter((row) => row.picked).length
  }
}

/** The label of the send button: "发给 Claude · 2". */
export const sendLabel = (agent: ReviewAgent, picked: number): string => `发给 ${reviewerLabel(agent)} · ${picked}`
