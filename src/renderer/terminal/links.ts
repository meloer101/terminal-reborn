// Links in terminal output (PRD F17): plain-text http(s) URLs and OSC 8 hyperlinks. A plain click opens the
// built-in browser, ⌘-click the system browser; a right-click on a link opens the link menu.
import { isAllowedUrl } from '@shared/browser'

/** A link in the output was clicked (`open`) or right-clicked (`menu`); x / y are client coordinates. */
export interface TerminalLink {
  url: string
  action: 'open' | 'menu'
  metaKey: boolean
  x: number
  y: number
}

export type LinkTarget = 'internal' | 'external'

/** URLs longer than this are not opened (they are not something an agent prints by accident). */
const MAX_URL_LENGTH = 8192

/** The URL to open, normalized; null for anything but http(s) (file:, javascript:, a bare word …). */
export function openableUrl(text: string): string | null {
  const value = text.trim()
  if (value === '' || value.length > MAX_URL_LENGTH || !isAllowedUrl(value)) return null
  return new URL(value).href
}

/** Plain click → the built-in browser; ⌘-click → the system browser. */
export function linkTarget(link: Pick<TerminalLink, 'metaKey'>): LinkTarget {
  return link.metaKey ? 'external' : 'internal'
}

/** Hover hint: the real address (an OSC 8 link's text can differ from it) and what a click does. */
export function linkHint(url: string): string {
  return `${url}\n单击在内置浏览器打开 · ⌘ 单击用系统浏览器打开`
}
