// Links in terminal output (PRD F17): plain-text http(s) URLs, OSC 8 hyperlinks and file paths inside the session's
// worktree. A plain click opens the built-in browser (a URL) or the 文件 view's preview (a path), ⌘-click the system
// browser or the default editor; a right-click on a link opens the link menu.
import { isAllowedUrl } from '@shared/browser'
import { pathLabel } from './file-links'

/** What a link points at: a URL, or a file as a POSIX path relative to the session's worktree. */
export type LinkRef = { kind: 'url'; url: string } | { kind: 'file'; path: string; line: number | null; column: number | null }

/** A link in the output was clicked (`open`) or right-clicked (`menu`); x / y are client coordinates. */
export type TerminalLink = LinkRef & {
  action: 'open' | 'menu'
  metaKey: boolean
  x: number
  y: number
}

export type LinkTarget = 'internal' | 'external'

/**
 * Which of the paths printed in the terminal are files of the session (see WorktreeFilesApi.resolveLinks): the
 * relative path of each, or null.
 */
export type PathResolver = (paths: readonly string[]) => Promise<(string | null)[]>

/** URLs longer than this are not opened (they are not something an agent prints by accident). */
const MAX_URL_LENGTH = 8192

/** The URL to open, normalized; null for anything but http(s) (file:, javascript:, a bare word …). */
export function openableUrl(text: string): string | null {
  const value = text.trim()
  if (value === '' || value.length > MAX_URL_LENGTH || !isAllowedUrl(value)) return null
  return new URL(value).href
}

/** Plain click → in the app (built-in browser / preview); ⌘-click → the system browser / default editor. */
export function linkTarget(link: Pick<TerminalLink, 'metaKey'>): LinkTarget {
  return link.metaKey ? 'external' : 'internal'
}

/** Hover hint: the real address (an OSC 8 link's text can differ from it) or the path, and what a click does. */
export function linkHint(ref: LinkRef): string {
  return ref.kind === 'url'
    ? `${ref.url}\n单击在内置浏览器打开 · ⌘ 单击用系统浏览器打开`
    : `${pathLabel(ref.path, ref.line, ref.column)}\n单击预览 · ⌘ 单击用默认编辑器打开`
}
