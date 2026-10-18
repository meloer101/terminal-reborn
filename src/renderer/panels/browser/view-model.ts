// What the 浏览器 view shows for a page state (Figma 13A / 13E). Pure, so the rules are unit-tested.
import type { AgentKind } from '@shared/types'
import { localPortOf, portUrl, type BrowserPageState, type ConsoleSummary, type ListeningPort } from '@shared/browser'

export type WellContent = 'empty' | 'error' | 'page'

export interface BrowserLayout {
  /** The ports row (端口 · tags): only when a port was found. */
  ports: boolean
  /** The console row at the bottom. */
  console: boolean
  well: WellContent
}

/** The ports row only when ports were found; the console row once a page loaded. */
export function browserLayout(page: BrowserPageState | undefined, ports: readonly ListeningPort[]): BrowserLayout {
  const hasPorts = ports.length > 0
  if (!page?.url) return { ports: hasPorts, console: false, well: 'empty' }
  return { ports: hasPorts, console: !page.loadError, well: page.loadError ? 'error' : 'page' }
}

/** The empty state's second line: what to do next. */
export function emptyHint(ports: readonly ListeningPort[]): string {
  return ports.length > 0 ? '点一下上面的端口就能打开，或在地址栏输入地址。' : '运行 dev server 后，检测到的端口会出现在这里，点一下就能打开。'
}

export interface ConsoleLine {
  /** Shown with an error StatusGlyph in the error color. */
  errors: string | null
  /** Tertiary text after the errors (or alone). */
  rest: string
}

/** "2 个错误" · "· 1 个警告"; "控制台没有错误" when quiet; "正在载入…" while loading with nothing to report. */
export function consoleLine(summary: ConsoleSummary, loading: boolean): ConsoleLine {
  const warnings = summary.warnings > 0 ? `${summary.warnings} 个警告` : ''
  if (summary.errors > 0) return { errors: `${summary.errors} 个错误`, rest: warnings ? `· ${warnings}` : '' }
  if (warnings) return { errors: null, rest: warnings }
  return { errors: null, rest: loading ? '正在载入…' : '控制台没有错误' }
}

/** "发给 Claude" / "发给 Codex"; a plain shell only gets the text in its input line too ("发到终端"). */
export function sendLabel(kind: AgentKind): string {
  if (kind === 'shell') return '发到终端'
  return `发给 ${kind === 'codex' ? 'Codex' : 'Claude'}`
}

/** Whether the page shows this port (same host and port as the tag opens). */
export function isOpenPort(port: ListeningPort, pageUrl: string): boolean {
  try {
    return new URL(pageUrl).origin === new URL(portUrl(port)).origin || (port.host === 'localhost' && localPortOf(pageUrl) === port.port)
  } catch {
    return false
  }
}

/** `:5173 vite` */
export function portText(port: ListeningPort): string {
  return port.label ? `:${port.port} ${port.label}` : `:${port.port}`
}
