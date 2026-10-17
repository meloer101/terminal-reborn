// Unified diff → rows for the 变更 view (PRD F5, Figma DiffLine 12:91). Pure.

/** A file's diff shows at most this many rows; the rest is summarised. */
export const MAX_DIFF_ROWS = 5000

export type DiffRowKind = 'hunk' | 'context' | 'add' | 'del'

export interface DiffRow {
  kind: DiffRowKind
  /** Line numbers in the old / new file (null where the side has no line, and for hunk headers). */
  old: number | null
  new: number | null
  /** The line without its +/−/space marker; the whole `@@ … @@` header for hunks. */
  text: string
}

export interface ParsedDiff {
  rows: DiffRow[]
  binary: boolean
  /** Rows left out past MAX_DIFF_ROWS. */
  truncated: number
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parseUnifiedDiff(text: string, maxRows = MAX_DIFF_ROWS): ParsedDiff {
  const rows: DiffRow[] = []
  let binary = false
  let truncated = 0
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      inHunk = false
      continue
    }
    if (!inHunk) {
      if (line.startsWith('Binary files ') || line === 'GIT binary patch') binary = true
      if (!HUNK.test(line)) continue
      inHunk = true
    }
    const push = (row: DiffRow) => {
      if (rows.length < maxRows) rows.push(row)
      else truncated++
    }
    const hunk = HUNK.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      push({ kind: 'hunk', old: null, new: null, text: line })
    } else if (line.startsWith('+')) push({ kind: 'add', old: null, new: newLine++, text: line.slice(1) })
    else if (line.startsWith('-')) push({ kind: 'del', old: oldLine++, new: null, text: line.slice(1) })
    else if (line.startsWith(' ') || line === '') push({ kind: 'context', old: oldLine++, new: newLine++, text: line.slice(1) })
    else if (line.startsWith('\\')) continue // "\ No newline at end of file"
    else inHunk = false
  }
  return { rows, binary, truncated }
}
