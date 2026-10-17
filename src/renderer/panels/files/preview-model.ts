// Lines of the read-only preview (Figma 13F): number, text and change mark. Pure.
import type { LineMark, LineMarkRange } from '@shared/worktree-files'

/** Longer files show this many lines; the rest is one ⌘↵ away in the default editor. */
export const MAX_PREVIEW_LINES = 10_000

export interface PreviewLine {
  number: number
  text: string
  mark: LineMark | null
}

/** `marks` = the file's changed ranges, or 'all-added' for a file git does not track yet. */
export function previewLines(text: string, marks: readonly LineMarkRange[] | 'all-added'): { rows: PreviewLine[]; truncated: boolean } {
  const all = text.replace(/\r\n?/g, '\n').split('\n')
  // A final newline ends the last line; it does not start an empty one.
  if (all.length > 1 && all[all.length - 1] === '') all.pop()
  const truncated = all.length > MAX_PREVIEW_LINES
  const kept = truncated ? all.slice(0, MAX_PREVIEW_LINES) : all
  const markOf = (n: number): LineMark | null => {
    if (marks === 'all-added') return 'add'
    for (const range of marks) if (n >= range.from && n <= range.to) return range.kind
    return null
  }
  return { rows: kept.map((line, i) => ({ number: i + 1, text: line.replace(/\t/g, '  '), mark: markOf(i + 1) })), truncated }
}
