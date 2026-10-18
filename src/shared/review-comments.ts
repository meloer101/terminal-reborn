// Inline review comments on Git · 变更 (PRD F5, Figma 03): what one comment is, how they are validated when the
// workspace file is read, and the one prompt they become when sent to the worktree's agent. Pure.

export type CommentGroup = 'uncommitted' | 'committed'
/** Which line numbers `line` / `endLine` count: the new file's (added and context lines) or the old one's (removed). */
export type CommentSide = 'new' | 'old'

export interface ReviewComment {
  id: string
  group: CommentGroup
  /** POSIX path relative to the worktree. */
  path: string
  side: CommentSide
  line: number
  /** Last line of the range (equals `line` for one line). */
  endLine: number
  /** The commented lines as they were when the comment was written (capped). */
  code: string
  text: string
  createdAt: number
}

export const MAX_COMMENTS_PER_WORKTREE = 200
export const MAX_COMMENT_TEXT = 4000
/** Lines and characters of code kept with a comment (and quoted in the prompt). */
export const MAX_CODE_LINES = 5
export const MAX_CODE_CHARS = 300
const MAX_PATH = 4096

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isLine = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 10_000_000

/** The commented lines, cut to MAX_CODE_LINES / MAX_CODE_CHARS. */
export function clipCode(lines: readonly string[]): string {
  const kept = lines.slice(0, MAX_CODE_LINES).join('\n')
  return kept.length > MAX_CODE_CHARS ? `${kept.slice(0, MAX_CODE_CHARS)}…` : kept
}

function sanitizeComment(value: unknown): ReviewComment | null {
  if (!isRecord(value)) return null
  const { id, group, path, side, line, endLine, code, text, createdAt } = value
  if (typeof id !== 'string' || id.length === 0 || id.length > 100) return null
  if (group !== 'uncommitted' && group !== 'committed') return null
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH || path.includes('\0') || path.startsWith('/')) return null
  if (side !== 'new' && side !== 'old') return null
  if (!isLine(line) || !isLine(endLine) || endLine < line) return null
  if (typeof text !== 'string' || text.trim() === '') return null
  return {
    id,
    group,
    path,
    side,
    line,
    endLine,
    code: typeof code === 'string' ? code.slice(0, MAX_CODE_CHARS + 1) : '',
    text: text.slice(0, MAX_COMMENT_TEXT),
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0
  }
}

/** Comments by worktree path from a saved workspace file, keeping only worktrees that still exist. */
export function sanitizeReviewComments(value: unknown, worktreePaths: ReadonlySet<string>): Record<string, ReviewComment[]> {
  const result: Record<string, ReviewComment[]> = {}
  if (!isRecord(value)) return result
  for (const [path, list] of Object.entries(value)) {
    if (!worktreePaths.has(path) || !Array.isArray(list)) continue
    const comments = list.map(sanitizeComment).filter((c): c is ReviewComment => c !== null).slice(0, MAX_COMMENTS_PER_WORKTREE)
    if (comments.length > 0) result[path] = comments
  }
  return result
}

/** "src/a.ts:42" or "src/a.ts:42-44"; removed lines say so, since their numbers are the old file's. */
export function commentLocation(comment: Pick<ReviewComment, 'path' | 'side' | 'line' | 'endLine'>): string {
  const lines = comment.endLine > comment.line ? `${comment.line}-${comment.endLine}` : `${comment.line}`
  return `${comment.path}:${lines}${comment.side === 'old' ? '（删除的行，旧文件行号）' : ''}`
}

/** Comments in reading order: by file, then by line. */
export function sortComments(comments: readonly ReviewComment[]): ReviewComment[] {
  return [...comments].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.createdAt - b.createdAt)
}

/**
 * The prompt the comments become: one numbered item per comment with its location, the quoted code and the note.
 * It is put into the agent's input line, unsent (PRD §2).
 */
export function reviewPrompt(comments: readonly ReviewComment[]): string {
  const items = sortComments(comments).map((comment, index) => {
    const quote = comment.code
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => `   > ${line.trim()}`)
    const note = comment.text.trim().split('\n').join('\n   ')
    return [`${index + 1}. ${commentLocation(comment)}`, ...quote, `   ${note}`].join('\n')
  })
  return `请按下面的审阅意见修改代码（行号是 diff 里的行号）：\n\n${items.join('\n\n')}\n\n改完后告诉我改了什么。`
}
