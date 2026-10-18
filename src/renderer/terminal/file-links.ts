// File paths in terminal output (PRD F17): `src/app.ts`, `src/app.ts:42:5`, `./docs/PRD.md`, `src/a.ts(42,5)`,
// absolute paths. This only finds candidates in a line of text; main decides which exist inside the session's
// worktree, and only those become links. Pure.

/** A path-looking run of text in a line; `start` / `end` cover the path and its line suffix. */
export interface PathCandidate {
  start: number
  end: number
  /** As printed, without the line suffix (relative to the worktree, or absolute). */
  path: string
  line: number | null
  column: number | null
}

/** Longer runs are not paths an agent prints. */
const MAX_PATH_LENGTH = 1024
/** Candidates checked per line, so a wall of text costs one bounded round trip. */
export const MAX_CANDIDATES_PER_LINE = 32

// Characters that end a path as printed: whitespace, quotes, brackets, list punctuation, box drawing / arrows /
// geometric shapes (agents' TUI chrome such as ⏺ ⎿ │ ●), the ellipsis, and CJK / full-width punctuation.
const DELIMITERS = String.raw`\s'"\x60()\[\]{}<>,;|=\u2026\u2190-\u23ff\u2500-\u25ff\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65`
/** A run of path characters, then an optional compiler-style `(line,col)`. */
const RUN = new RegExp(String.raw`[^${DELIMITERS}]+(?:\((\d+)(?:,(\d+))?\))?`, 'gu')
const TRAILING_PUNCTUATION = /[.:!?]+$/
const LINE_SUFFIX = /^(.*?)(?::(\d+)(?::(\d+))?|#L(\d+))$/
const EXTENSION = /\.[A-Za-z0-9]{1,12}$/

export function findPathCandidates(text: string): PathCandidate[] {
  const out: PathCandidate[] = []
  for (const match of text.matchAll(RUN)) {
    if (out.length >= MAX_CANDIDATES_PER_LINE) break
    const candidate = parseRun(match[0], match.index)
    if (candidate) out.push(candidate)
  }
  return out
}

function parseRun(run: string, index: number): PathCandidate | null {
  let start = index
  let body = run
  let line: number | null = null
  let column: number | null = null
  // `src/a.ts(42,5)` (tsc and friends): the link runs to the closing parenthesis.
  const paren = /\((\d+)(?:,(\d+))?\)$/.exec(body)
  if (paren) {
    line = Number(paren[1])
    column = paren[2] ? Number(paren[2]) : null
    body = body.slice(0, paren.index)
  }
  // `@src/a.ts` is how agents mention files.
  if (body.startsWith('@')) {
    body = body.slice(1)
    start += 1
  }
  body = body.replace(TRAILING_PUNCTUATION, '')
  // Without a parenthesis the link is the path and its `:line:col` / `#Lline`, minus trailing punctuation.
  const end = paren ? index + run.length : start + body.length
  if (!paren) {
    const suffix = LINE_SUFFIX.exec(body)
    if (suffix) {
      body = suffix[1]!
      line = Number(suffix[2] ?? suffix[4])
      column = suffix[3] ? Number(suffix[3]) : null
    }
  }
  const path = body.replace(/\/+$/, '')
  if (!looksLikePath(path)) return null
  return { start, end, path, line: line && line > 0 ? line : null, column: line && column && column > 0 ? column : null }
}

function looksLikePath(path: string): boolean {
  if (path === '' || path.length > MAX_PATH_LENGTH) return false
  // URLs are the web-link provider's; a colon left over is `scheme:` or `error:`, not a macOS path.
  if (path.includes(':')) return false
  if (!/\p{L}/u.test(path)) return false
  if (path.split('/').every((part) => part === '' || part === '.' || part === '..')) return false
  return path.includes('/') || EXTENSION.test(path)
}

/** One cell of a terminal row: its text ('' for an empty cell or the second half of a wide character) and width. */
export interface Cell {
  chars: string
  width: number
}

/**
 * The text of a run of cells and, for every UTF-16 index of it, the cell it sits in (wide characters take two
 * cells; empty cells read as spaces). `cells[text.length]` is the total cell count.
 */
export function cellText(cells: Iterable<Cell>): { text: string; cells: number[] } {
  let text = ''
  const at: number[] = []
  let offset = 0
  for (const cell of cells) {
    if (cell.width === 0) continue
    const chars = cell.chars === '' ? ' ' : cell.chars
    text += chars
    for (let i = 0; i < chars.length; i++) at.push(offset)
    offset += cell.width
  }
  at.push(offset)
  return { text, cells: at }
}

/** Hover hint for a path link. */
export function pathLabel(path: string, line: number | null, column: number | null): string {
  return `${path}${line === null ? '' : `:${line}`}${line !== null && column !== null ? `:${column}` : ''}`
}
