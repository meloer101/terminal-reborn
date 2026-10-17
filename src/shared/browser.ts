// The right panel's 浏览器 view (PRD F17 · Figma 13A / 13E) and the minimal port detection behind it (F14).
// Pure: address parsing, console summarising and port-list parsing / diffing, shared by main and renderer.
import type { SessionId } from './types'

/** Only these schemes are ever loaded in the built-in browser. */
export function isAllowedUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\]|[\w-]+\.(?:localhost|local|test))(?::\d+)?$/i
/** Hosts that get plain http when typed without a scheme: this machine and bare IPv4 addresses (LAN dev servers). */
const PLAIN_HTTP_HOST = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/
const MAX_PORT = 65535
export const MAX_URL_LENGTH = 8192

export type ParsedAddress = { ok: true; url: string } | { ok: false; error: string }

/**
 * What the user typed in the address field, as a URL to load:
 * `5173` / `:5173` → http://localhost:5173 · `localhost:3000/x` → http://… · `example.com` → https://… .
 * Only http(s); anything else (file:, javascript:, custom schemes, words with spaces) is refused with a reason.
 */
export function parseAddress(input: string): ParsedAddress {
  const text = input.trim()
  if (!text) return { ok: false, error: '输入地址或端口号' }
  if (text.length > MAX_URL_LENGTH) return { ok: false, error: '地址太长' }
  const port = /^:?(\d{1,5})(\/.*)?$/.exec(text)
  if (port) {
    const n = Number(port[1])
    if (n < 1 || n > MAX_PORT) return { ok: false, error: '端口号要在 1–65535 之间' }
    return { ok: true, url: new URL(`http://localhost:${n}${port[2] ?? ''}`).href }
  }
  if (/\s/.test(text)) return { ok: false, error: '地址里不能有空格' }
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(text)
  // `localhost:3000` parses as scheme "localhost"; a real scheme is followed by `//` or is not host-like.
  const hostLike = scheme && /^[\w.-]+:\d/.test(text)
  if (scheme && !hostLike) {
    if (!isAllowedUrl(text)) return { ok: false, error: '只能打开 http 或 https 地址' }
    return { ok: true, url: new URL(text).href }
  }
  const host = text.split(/[/?#]/)[0] ?? ''
  const url = `${LOCAL_HOST.test(host) || PLAIN_HTTP_HOST.test(host) ? 'http' : 'https'}://${text}`
  try {
    return { ok: true, url: new URL(url).href }
  } catch {
    return { ok: false, error: '不是有效的地址' }
  }
}

/** The address field's two parts: host (primary color) and the rest (tertiary). Not a URL → all host. */
export function splitUrl(url: string): { host: string; path: string } {
  if (!url) return { host: '', path: '' }
  try {
    const parsed = new URL(url)
    const rest = `${parsed.pathname}${parsed.search}${parsed.hash}`
    const scheme = parsed.protocol === 'https:' || parsed.protocol === 'http:' ? '' : `${parsed.protocol}//`
    return { host: `${scheme}${parsed.host}`, path: rest === '/' ? '' : rest }
  } catch {
    return { host: url, path: '' }
  }
}

/** The port a URL points at on this machine, or null (another host, or not a URL). */
export function localPortOf(url: string): number | null {
  try {
    const parsed = new URL(url)
    if (!LOCAL_HOST.test(parsed.host)) return null
    if (parsed.port) return Number(parsed.port)
    return parsed.protocol === 'https:' ? 443 : 80
  } catch {
    return null
  }
}

// ── Console ────────────────────────────────────────────────────────────────────────────────────────────────────

export type ConsoleLevel = 'info' | 'warning' | 'error' | 'debug'

export interface ConsoleEntry {
  level: ConsoleLevel
  message: string
  /** Script URL that logged it ('' when unknown). */
  source: string
  line: number
}

/** Errors / warnings since the page last loaded, plus the latest errors to send to the agent. */
export interface ConsoleSummary {
  errors: number
  warnings: number
  /** Newest last, at most MAX_RECENT_ERRORS, each message cut to MAX_ERROR_CHARS. */
  recentErrors: ConsoleEntry[]
}

export const MAX_RECENT_ERRORS = 10
export const MAX_ERROR_CHARS = 600

export const EMPTY_CONSOLE: ConsoleSummary = { errors: 0, warnings: 0, recentErrors: [] }

/** Adds one `console-message` to the summary (info / debug only pass through). */
export function addConsoleEntry(summary: ConsoleSummary, entry: ConsoleEntry): ConsoleSummary {
  if (entry.level === 'warning') return { ...summary, warnings: summary.warnings + 1 }
  if (entry.level !== 'error') return summary
  const clipped = entry.message.length > MAX_ERROR_CHARS ? `${entry.message.slice(0, MAX_ERROR_CHARS)}…` : entry.message
  const recentErrors = [...summary.recentErrors, { ...entry, message: clipped }].slice(-MAX_RECENT_ERRORS)
  return { errors: summary.errors + 1, warnings: summary.warnings, recentErrors }
}

/** `src/App.tsx:12` for a script URL on the page's own origin, the full URL otherwise. */
function where(entry: ConsoleEntry, pageUrl: string): string {
  if (!entry.source) return ''
  let source = entry.source
  try {
    const src = new URL(entry.source)
    if (src.origin === new URL(pageUrl).origin) source = `${src.pathname.replace(/^\//, '')}${src.search}`
  } catch {
    // Not a URL (e.g. "VM12"): keep as is.
  }
  return entry.line > 0 ? `${source}:${entry.line}` : source
}

/** What "发给 Claude" types into the session: the page, then each distinct recent error (newest last). */
export function formatErrorsForAgent(summary: ConsoleSummary, pageUrl: string, limit = 5): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const entry of [...summary.recentErrors].reverse()) {
    const at = where(entry, pageUrl)
    const line = `- ${entry.message.replace(/\s*\n\s*/g, ' ⏎ ')}${at ? ` (${at})` : ''}`
    if (seen.has(line)) continue
    seen.add(line)
    lines.unshift(line)
    if (lines.length >= limit) break
  }
  return [`浏览器里 ${pageUrl} 的控制台有 ${summary.errors} 个错误，请看一下并修复：`, ...lines].join('\n')
}

// ── Ports (F14, minimal) ───────────────────────────────────────────────────────────────────────────────────────

export interface ListeningPort {
  port: number
  pid: number
  /** Short name for the tag, e.g. "vite" ('' when nothing better than the runtime is known). */
  label: string
}

export interface ProcessInfo {
  pid: number
  ppid: number
  args: string
}

/** `ps -A -o pid=,ppid=,args=` → processes. */
export function parsePs(output: string): ProcessInfo[] {
  const list: ProcessInfo[] = []
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (match) list.push({ pid: Number(match[1]), ppid: Number(match[2]), args: (match[3] ?? '').trim() })
  }
  return list
}

/** `root` and every process below it. */
export function processTree(processes: ProcessInfo[], root: number): ProcessInfo[] {
  const children = new Map<number, ProcessInfo[]>()
  for (const p of processes) {
    const list = children.get(p.ppid)
    if (list) list.push(p)
    else children.set(p.ppid, [p])
  }
  const self = processes.find((p) => p.pid === root)
  const result: ProcessInfo[] = self ? [self] : [{ pid: root, ppid: 0, args: '' }]
  const seen = new Set([root])
  for (const parent of result) {
    for (const child of children.get(parent.pid) ?? []) {
      if (seen.has(child.pid)) continue
      seen.add(child.pid)
      result.push(child)
    }
  }
  return result
}

/**
 * `lsof -nP -a -iTCP -sTCP:LISTEN -p <pids> -F pn` → (pid, port) pairs. The same port on IPv4 and IPv6 counts
 * once; sorted by port.
 */
export function parseLsofListen(output: string): Array<{ pid: number; port: number }> {
  const found = new Map<number, number>()
  let pid = 0
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n')) {
      const port = Number(/:(\d+)$/.exec(line)?.[1])
      if (pid > 0 && port > 0 && port <= MAX_PORT && !found.has(port)) found.set(port, pid)
    }
  }
  return [...found].map(([port, p]) => ({ pid: p, port })).sort((a, b) => a.port - b.port)
}

/** Tools worth naming on a tag, matched against the listening process's command line. */
const KNOWN_SERVERS = ['storybook', 'vite', 'next', 'nuxt', 'astro', 'remix', 'webpack', 'parcel', 'expo', 'wrangler', 'jupyter', 'rails', 'django', 'flask', 'uvicorn', 'gunicorn', 'hugo', 'jekyll']
const RUNTIMES = new Set(['node', 'bun', 'deno', 'python', 'python3', 'ruby', 'java', 'php', 'sh', 'bash', 'zsh'])

/** "vite" for `node /x/node_modules/.bin/vite --port 5173`; the binary's name when it is not a runtime; else ''. */
export function serverLabel(args: string): string {
  const lower = args.toLowerCase()
  for (const name of KNOWN_SERVERS) {
    if (new RegExp(`(^|[\\s/@])${name}(?:[\\s./@-]|$)`).test(lower)) return name
  }
  const binary = lower.split(/\s+/)[0]?.split('/').pop() ?? ''
  return binary && !RUNTIMES.has(binary) && !/^python\d/.test(binary) ? binary.slice(0, 16) : ''
}

/** Whether two port lists differ (order-insensitive), so unchanged polls send nothing. */
export function portsChanged(a: readonly ListeningPort[], b: readonly ListeningPort[]): boolean {
  if (a.length !== b.length) return true
  const key = (p: ListeningPort) => `${p.port}:${p.pid}:${p.label}`
  const left = new Set(a.map(key))
  return b.some((p) => !left.has(key(p)))
}

// ── IPC contract (wired into TrApi in ipc.ts) ──────────────────────────────────────────────────────────────────

/** The page well's rectangle in the window, CSS px. */
export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

/** One worktree's page, as main sees it. */
export interface BrowserPageState {
  /** The worktree's absolute path: one page per worktree. */
  worktree: string
  /** '' = nothing opened yet (empty state 13E). */
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** 375-wide mobile viewport. */
  mobile: boolean
  /** The last main-frame load failed (e.g. nothing listens on that port): user-facing text. */
  loadError: string | null
  console: ConsoleSummary
}

export interface SessionPorts {
  sessionId: SessionId
  ports: ListeningPort[]
}

export interface BrowserApi {
  /** Puts the worktree's page over `bounds` (creates it, reopening its remembered URL); hides every other page. */
  show(worktree: string, bounds: BrowserBounds): void
  /** Hides the page in this window (pane closed, overview, …). */
  hide(): void
  /** Something covers the page (a menu or dialog): resolves to a snapshot (data URL) once it is hidden. */
  cover(): Promise<string | null>
  navigate(worktree: string, url: string): void
  back(worktree: string): void
  forward(worktree: string): void
  reload(worktree: string): void
  setMobile(worktree: string, mobile: boolean): void
  /** Opens the page's URL in the system browser. */
  openExternal(worktree: string): void
  getState(worktree: string): Promise<BrowserPageState>
  onState(listener: (state: BrowserPageState) => void): () => void
  /** Polls the session's listening ports while watched (PRD F14, minimal); results arrive through onPorts. */
  watchPorts(sessionId: SessionId): void
  unwatchPorts(sessionId: SessionId): void
  onPorts(listener: (ports: SessionPorts) => void): () => void
}

export const BROWSER_IPC = {
  show: 'browser:show',
  hide: 'browser:hide',
  /** invoke → string | null */
  cover: 'browser:cover',
  navigate: 'browser:navigate',
  back: 'browser:back',
  forward: 'browser:forward',
  reload: 'browser:reload',
  setMobile: 'browser:set-mobile',
  openExternal: 'browser:open-external',
  /** invoke → BrowserPageState */
  getState: 'browser:get-state',
  /** main → renderer, payload BrowserPageState */
  state: 'browser:state',
  watchPorts: 'browser:watch-ports',
  unwatchPorts: 'browser:unwatch-ports',
  /** main → renderer, payload SessionPorts */
  ports: 'browser:ports'
} as const
