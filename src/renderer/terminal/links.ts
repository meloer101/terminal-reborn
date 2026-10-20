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

// Characters that end a plain-text URL besides the ASCII ones @xterm/addon-web-links already stops at: CJK text
// (Hangul jamo, CJK radicals through compatibility, unified ideographs, Hangul syllables, compatibility ideographs,
// supplementary ideographs), CJK / full-width punctuation (、。「」（），！？ …), general punctuation (“” … ——), arrows,
// box drawing and the symbols agents' TUIs draw. Chinese prose puts no space after a URL, so without these
// `https://x.com/a。现在可以了` was one link (orca#30213). A raw CJK path segment ends the link too; agents print such
// URLs percent-encoded.
const NOT_URL = String.raw`\u1100-\u11ff\u2000-\u206f\u2190-\u23ff\u2500-\u27bf\u2e80-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\u{20000}-\u{3fffd}`
const STOP = String.raw`\s"'\x60<>{}|\\^${NOT_URL}`
/** Anywhere in the URL (like the addon: no `!`, `*` or parentheses outside a balanced pair). */
const URL_CHAR = `[^${STOP}()!*]`
/** The last character: not trailing punctuation or a bracket. */
const URL_LAST = String.raw`[^${STOP}():,.!?~\[\]]`
/** `/wiki/Foo_(bar)`: a balanced pair of ASCII parentheses stays in the URL, a lone `)` closing prose does not. */
const URL_PARENS = String.raw`\(${URL_CHAR}*\)`

/**
 * Plain-text http(s) URLs, for WebLinksAddon's `urlRegex` (it adds the `g` flag itself, so there is none here). Same
 * as the addon's default pattern for ASCII text, except that balanced parentheses are kept.
 */
export const URL_PATTERN = new RegExp(`(?:https?|HTTPS?)://(?:${URL_CHAR}|${URL_PARENS})*(?:${URL_LAST}|${URL_PARENS})`, 'u')

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
