// The subagents an agent starts inside its own session (PRD F21 v1.107, Figma 44B): shown under the session, never
// taken over. Claude Code writes `<transcript without .jsonl>/subagents/agent-<agent_id>.meta.json` as it starts one
// (`description`, `agentType`, `requestShape`, sometimes `model`) and the subagent's own transcript beside it (PRD
// §6.14 v1.107, measured on 2.1.316). We read them after the first hook that names an `agent_id` and drop the subagent
// at its SubagentStop. Reading the agent's own files instead of asking it follows yetone/magpie
// (internal/sessions/subagents.go, MIT); no code is taken from it.
// Files are only read, and only under Claude's projects directory (the hook payload's transcript path is checked).
import { join, sep } from 'node:path'
import type { HookAgent, SubagentInfo } from '@shared/agent-events'
import { claudeTranscriptPath, cleanTitle, defaultAgentDataDirs, type AgentDataDirs } from './agent-title'
import { readHead } from './codex-usage'

/**
 * The meta file is a few hundred bytes. The model is in the subagent transcript's `model` attachment, which sits after
 * the tool and skill listings: ~87 KB in, the first assistant line at ~255 KB (2.1.316, PRD §6.14 v1.108). Read once
 * per subagent, off any hot path.
 */
const META_BYTES = 64 * 1024
const HEAD_BYTES = 1024 * 1024
/** A subagent whose meta or model was not there yet is read again on a later hook, at most this often. */
const RETRY_MS = 2_000
/** And on its own this many times, RETRY_MS apart: a subagent in one long tool call sends no hook to retry on. */
const TIMED_RETRIES = 3

type Rec = Record<string, unknown>
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Claude's `agent_id` (hex, `a` + 16 on 2.1.316); anything else never becomes part of a path. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

export function subagentIdOf(payload: Rec): string | null {
  const id = payload.agent_id
  // A compaction's own run (agent-acompact-<id>) is no subagent anyone started (magpie skips it too).
  return typeof id === 'string' && SAFE_ID.test(id) && !id.startsWith('acompact-') ? id : null
}

/** `claude-opus-5-5` → `Opus 5.5`, `claude-haiku-4-5-20251001` → `Haiku 4.5`; anything else as written. */
export function claudeModelLabel(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/.exec(raw)
  if (!match) return cleanTitle(raw) ?? undefined
  const [, family = '', major = '', minor] = match
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
}

export interface SubagentMeta {
  title?: string
  model?: string
  /** A foreground subagent cannot outlive its turn; a background one can. */
  foreground: boolean
}

/** What `agent-<id>.meta.json` says. The task is `description`, else the agent's `name`, else its type. */
export function parseSubagentMeta(text: string): SubagentMeta | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRec(value)) return null
  const title = cleanTitle(value.description) ?? cleanTitle(value.name) ?? cleanTitle(value.agentType) ?? undefined
  const model = claudeModelLabel(value.model)
  return { ...(title ? { title } : {}), ...(model ? { model } : {}), foreground: value.requestShape === 'foreground' }
}

/**
 * The model in a subagent's transcript head: its `model` attachment's display name (`identity.marketingName`, as the
 * CLI shows it), else the model of the first assistant line. The listings before them are skipped unparsed.
 */
export function transcriptModel(text: string): string | undefined {
  for (const line of text.split('\n')) {
    const named = line.includes('"marketingName"')
    if (!named && !line.includes('"type":"assistant"')) continue
    try {
      const entry: unknown = JSON.parse(line)
      if (!isRec(entry)) continue
      if (named && isRec(entry.attachment) && entry.attachment.type === 'model' && isRec(entry.attachment.identity)) {
        const name = cleanTitle(entry.attachment.identity.marketingName) ?? claudeModelLabel(entry.attachment.identity.modelId)
        if (name) return name
      }
      if (entry.type === 'assistant' && isRec(entry.message)) {
        const model = claudeModelLabel(entry.message.model)
        if (model) return model
      }
    } catch {
      // a line cut at the end of the head
    }
  }
  return undefined
}

export type HeadReader = (path: string, maxBytes: number) => Promise<string>

interface Sub {
  id: string
  title?: string
  model?: string
  foreground: boolean
  reading: boolean
  readAt: number
  /** Timed re-reads left (TIMED_RETRIES). */
  retries: number
}

interface Tracked {
  transcript?: string
  /** Running subagents, in the order they first spoke. */
  subs: Map<string, Sub>
  /** Stopped ones: a late hook of theirs does not bring them back. */
  ended: Set<string>
  /** The list last sent ('' before the first): only changes are emitted, but a restarted session always hears once. */
  sent: string
}

/**
 * Follows Claude's hooks and reports the session's running subagents whenever the list changes. Electron-free: the glue
 * supplies `emit`; tests supply the reader and the clock.
 */
export class SubagentWatcher {
  private readonly sessions = new Map<string, Tracked>()
  private readonly dirs: AgentDataDirs
  private readonly read: HeadReader
  private readonly now: () => number
  private readonly schedule: (fn: () => void, ms: number) => void

  constructor(
    private readonly emit: (sessionId: string, agent: HookAgent, items: SubagentInfo[]) => void,
    options: { dirs?: AgentDataDirs; read?: HeadReader; now?: () => number; schedule?: (fn: () => void, ms: number) => void } = {}
  ) {
    this.dirs = options.dirs ?? defaultAgentDataDirs()
    this.read = options.read ?? readHead
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? ((fn, ms) => void setTimeout(fn, ms).unref())
  }

  /** One hook call for an attached session. */
  observe(sessionId: string, agent: HookAgent, event: string, payload: unknown): void {
    if (agent !== 'claude' || !isRec(payload)) return
    let tracked = this.sessions.get(sessionId)
    if (!tracked) {
      tracked = { subs: new Map(), ended: new Set(), sent: '' }
      this.sessions.set(sessionId, tracked)
    }
    const transcript = claudeTranscriptPath(payload.transcript_path, this.dirs)
    // Only the session's own transcript locates its subagents folder; a subagent's own one (if a hook ever names it) does not.
    if (transcript && !transcript.includes(`${sep}subagents${sep}`)) tracked.transcript = transcript
    const id = subagentIdOf(payload)
    if (event === 'SessionStart' || event === 'SessionEnd') {
      // A new, cleared or resumed conversation, or the agent quit: whatever ran belongs to a transcript no longer live.
      tracked.subs.clear()
      tracked.ended.clear()
      this.publish(sessionId, tracked)
      return
    }
    if (event === 'SubagentStop') {
      if (!id) return
      tracked.subs.delete(id)
      tracked.ended.add(id)
      this.publish(sessionId, tracked)
      return
    }
    // A foreground subagent cannot outlive its turn: gone at the turn's end, or by the next prompt when the user
    // interrupted it (no Stop then).
    if ((event === 'Stop' || event === 'UserPromptSubmit') && !id) {
      for (const sub of tracked.subs.values()) if (sub.foreground) tracked.subs.delete(sub.id)
      this.publish(sessionId, tracked)
      return
    }
    if (!id || tracked.ended.has(id)) return
    let sub = tracked.subs.get(id)
    if (!sub) {
      sub = { id, foreground: false, reading: false, readAt: -Infinity, retries: TIMED_RETRIES }
      tracked.subs.set(id, sub)
    }
    if ((!sub.title || !sub.model) && !sub.reading && this.now() - sub.readAt >= RETRY_MS) void this.readSub(sessionId, tracked, sub)
  }

  /** The session's PTY ended or was re-spawned: stop following it. */
  forget(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  private async readSub(sessionId: string, tracked: Tracked, sub: Sub): Promise<void> {
    if (!tracked.transcript) return
    sub.reading = true
    sub.readAt = this.now()
    const dir = join(tracked.transcript.slice(0, -'.jsonl'.length), 'subagents')
    try {
      const meta = parseSubagentMeta(await this.read(join(dir, `agent-${sub.id}.meta.json`), META_BYTES))
      if (meta) {
        sub.foreground = meta.foreground
        sub.title = meta.title ?? sub.title
        sub.model = meta.model ?? sub.model
      }
      if (!sub.model) sub.model = transcriptModel(await this.read(join(dir, `agent-${sub.id}.jsonl`), HEAD_BYTES))
    } finally {
      sub.reading = false
    }
    // Forgotten, restarted or stopped while reading: the answer is about something no longer listed.
    if (this.sessions.get(sessionId) !== tracked || tracked.subs.get(sub.id) !== sub) return
    this.publish(sessionId, tracked)
    if ((!sub.title || !sub.model) && sub.retries > 0) {
      sub.retries -= 1
      this.schedule(() => {
        if (this.sessions.get(sessionId) === tracked && tracked.subs.get(sub.id) === sub && !sub.reading) void this.readSub(sessionId, tracked, sub)
      }, RETRY_MS)
    }
  }

  private publish(sessionId: string, tracked: Tracked): void {
    const items: SubagentInfo[] = []
    for (const sub of tracked.subs.values()) if (sub.title) items.push({ id: sub.id, title: sub.title, ...(sub.model ? { model: sub.model } : {}) })
    const key = JSON.stringify(items)
    if (key === tracked.sent) return
    tracked.sent = key
    this.emit(sessionId, 'claude', items)
  }
}
