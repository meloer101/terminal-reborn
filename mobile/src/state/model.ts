// What the phone's screens show, derived from what Wavi sends (PRD F22): a session's conversation kept in step with the
// pages and pushes of src/main/remote/feed.ts, the session list's groups (Figma 45B), and short times. Pure.
import type { RemoteSession, RemoteSessionList } from '../../../src/shared/remote'
import type { ChatItem, DiffHunk } from '../../../src/shared/transcript-chat'

/** The part of a session's conversation the phone has: items `start` … `start + items.length - 1`. */
export interface Feed {
  start: number
  items: ChatItem[]
}

/** A page from `watch` / `feed`, or a push: replaces, extends or rewrites the end of what the phone has. */
export function applyFeed(feed: Feed | undefined, update: { start: number; items: ChatItem[]; reset?: boolean }): Feed {
  if (!feed || update.reset) return { start: update.start, items: update.items }
  const end = feed.start + feed.items.length
  // A gap (the phone missed pushes) or something before what it has: take the update as the new truth.
  if (update.start > end || update.start < feed.start) return { start: update.start, items: update.items }
  return { start: feed.start, items: [...feed.items.slice(0, update.start - feed.start), ...update.items] }
}

/** An older page (ending where the feed starts) goes in front. */
export function prependFeed(feed: Feed, page: { start: number; items: ChatItem[] }): Feed {
  if (page.start + page.items.length !== feed.start) return feed
  return { start: page.start, items: [...page.items, ...feed.items] }
}

export interface SessionGroup {
  key: string
  title: string
  rows: { session: RemoteSession; projectName?: string }[]
}

/** 等你处理 first (with each row's project), then one group per project in the window's order; newest first (45B). */
export function groupSessions(list: RemoteSessionList): SessionGroup[] {
  const byActivity = (a: RemoteSession, b: RemoteSession) => b.activity - a.activity
  const projectName = new Map(list.projects.map((p) => [p.id, p.name]))
  const waiting = list.sessions.filter((s) => s.status === 'needs_you').sort((a, b) => (b.since ?? b.activity) - (a.since ?? a.activity))
  const groups: SessionGroup[] = []
  if (waiting.length) groups.push({ key: 'waiting', title: '等你处理', rows: waiting.map((session) => ({ session, projectName: projectName.get(session.projectId) })) })
  for (const project of list.projects) {
    const rows = list.sessions.filter((s) => s.projectId === project.id && s.status !== 'needs_you').sort(byActivity)
    if (rows.length) groups.push({ key: project.id, title: project.name, rows: rows.map((session) => ({ session })) })
  }
  return groups
}

/** `45s` / `3m` / `2h` / `4d`. */
export function shortAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/** The right-hand time of a session row: how long it has waited, or how long since it last did something. */
export function rowTime(session: RemoteSession, now: number): string {
  if (session.status === 'needs_you') return `已等 ${shortAge(now - (session.since ?? session.activity))}`
  return shortAge(now - session.activity)
}

export type DiffRow =
  | { kind: 'hunk'; text: string }
  | { kind: 'line'; sign: ' ' | '+' | '-'; old: number | null; new: number | null; code: string }

/** Hunks (Edit / Write `structuredPatch`) → numbered rows, as 45D draws them. */
export function hunkRows(hunks: readonly DiffHunk[]): DiffRow[] {
  const rows: DiffRow[] = []
  for (const hunk of hunks) {
    const oldCount = hunk.lines.filter((l) => !l.startsWith('+')).length
    const newCount = hunk.lines.filter((l) => !l.startsWith('-')).length
    rows.push({ kind: 'hunk', text: `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@` })
    let o = hunk.oldStart
    let n = hunk.newStart
    for (const line of hunk.lines) {
      const sign = line[0] === '+' || line[0] === '-' ? line[0] : ' '
      const code = line.slice(1)
      if (sign === '+') rows.push({ kind: 'line', sign, old: null, new: n++, code })
      else if (sign === '-') rows.push({ kind: 'line', sign, old: o++, new: null, code })
      else rows.push({ kind: 'line', sign, old: o++, new: n++, code })
    }
  }
  return rows
}

/** `git diff` text (a file of Git · 变更) → the same rows; header lines before the first hunk are dropped. */
export function unifiedRows(text: string): DiffRow[] {
  const rows: DiffRow[] = []
  let o = 0
  let n = 0
  let inHunk = false
  for (const line of text.split('\n')) {
    const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line)
    if (head) {
      o = Number(head[1])
      n = Number(head[2])
      inHunk = true
      rows.push({ kind: 'hunk', text: line })
      continue
    }
    if (!inHunk || line.startsWith('\\')) continue
    if (line.startsWith('+')) rows.push({ kind: 'line', sign: '+', old: null, new: n++, code: line.slice(1) })
    else if (line.startsWith('-')) rows.push({ kind: 'line', sign: '-', old: o++, new: null, code: line.slice(1) })
    else if (line.startsWith(' ')) rows.push({ kind: 'line', sign: ' ', old: o++, new: n++, code: line.slice(1) })
  }
  return rows
}

/** `src/auth/session.ts` → `session.ts` and `src/auth/`. */
export function splitPath(path: string): { name: string; dir: string } {
  const at = path.lastIndexOf('/')
  return at < 0 ? { name: path, dir: '' } : { name: path.slice(at + 1), dir: path.slice(0, at + 1) }
}

/** The last line worth showing under a Bash row (45C: `✓ 12 passed (1.4s)`). */
export function lastLine(output: string | undefined): string | null {
  const lines = (output ?? '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '')
  return lines.at(-1) ?? null
}

/** Tailscale's CGNAT range 100.64.0.0/10: how the top of 45B names the way it is connected. */
export function viaOf(url: string): '局域网' | 'Tailscale' {
  const m = /^wss?:\/\/100\.(\d+)\./.exec(url)
  return m && Number(m[1]) >= 64 && Number(m[1]) <= 127 ? 'Tailscale' : '局域网'
}

/** 45E's title: what the agent wants to do. */
export function permissionTitle(tool: string): string {
  if (tool === 'Bash') return '运行命令'
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write' || tool === 'NotebookEdit') return '修改文件'
  if (tool === 'WebFetch') return '访问网页'
  if (tool === 'WebSearch') return '搜索网页'
  return `使用 ${tool}`
}

/** The line in 45E's command box: the command, the file or the address; the summary otherwise. */
export function permissionSubject(input: Record<string, unknown>, summary: string): string {
  for (const key of ['command', 'file_path', 'notebook_path', 'url', 'query', 'pattern']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return summary
}

/** 总是允许 pnpm add: what the rule the agent offered covers. */
export function allowAlwaysLabel(rules: readonly { tool: string; content?: string }[] | undefined): string {
  const rule = rules?.[0]
  if (!rule) return '总是允许'
  const what = (rule.content ?? rule.tool).replace(/:\*$/, '').replace(/^domain:/, '')
  return `总是允许 ${what}${rules.length > 1 ? ` 等 ${rules.length} 项` : ''}`
}
