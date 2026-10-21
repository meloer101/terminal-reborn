// Rendered Markdown in the read-only preview: which files render, where a link in one goes, heading anchors. Pure.

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

export const isMarkdownPath = (path: string): boolean => MARKDOWN.test(path)

export type MarkdownHref =
  | { kind: 'url'; url: string }
  | { kind: 'anchor'; id: string }
  /** Relative to the worktree root, not yet checked to exist. */
  | { kind: 'file'; path: string; line: number | null }

/** Where `href` in the file at `from` (relative to the root) points; null for what the preview does not open. */
export function resolveMarkdownHref(href: string, from: string): MarkdownHref | null {
  const value = href.trim()
  if (value === '') return null
  if (/^https?:\/\//i.test(value)) return { kind: 'url', url: value }
  // mailto:, file:, javascript:, a protocol-relative //host … stay closed.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return null
  const hash = value.indexOf('#')
  const fragment = hash === -1 ? '' : value.slice(hash + 1)
  const target = (hash === -1 ? value : value.slice(0, hash)).replace(/\?.*$/, '')
  if (target === '') return fragment === '' ? null : { kind: 'anchor', id: decode(fragment) }
  const path = joinPath(target.startsWith('/') ? '' : parentDir(from), decode(target))
  if (path === null || path === '') return null
  const line = /^L(\d+)/.exec(fragment)
  return { kind: 'file', path, line: line ? Number(line[1]) : null }
}

/** `src` of an image as a path inside the worktree; null for remote, data and escaping ones. */
export function imagePath(src: string, from: string): string | null {
  const href = resolveMarkdownHref(src, from)
  return href?.kind === 'file' ? href.path : null
}

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens (letters of any script kept). */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

function parentDir(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

/** `dir` + `rel` with `.` and `..` resolved; null when it climbs out of the root. */
function joinPath(dir: string, rel: string): string | null {
  const parts: string[] = dir === '' ? [] : dir.split('/')
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else parts.push(part)
  }
  return parts.join('/')
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
