// The agent's own session title (PRD F2, §6.6, §6.7). Claude Code and Codex already name every conversation with a
// small model on the user's own plan; we only read that name back, never generate one or call a model ourselves.
// - Claude writes `{"type":"ai-title","aiTitle"}` (and `{"type":"custom-title","customTitle"}` for /rename) into
//   the transcript at `transcript_path`, re-appended near the tail every turn.
// - Codex (TUI ≥ 0.163) appends `{"id":<session_id>,"thread_name"}` to $CODEX_HOME/session_index.jsonl right after
//   the first turn ends.
// Both files are only ever read. Hook payloads choose which file to read, so the paths are confined to the agents'
// own data directories.
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize, sep } from 'node:path'
import type { HookAgent } from '@shared/agent-events'
import { isSafeAgentSessionId } from '@shared/workspace-file'
import type { Scheduler } from './permission-registry'

const MAX_TITLE_CHARS = 80
/** Transcripts can be large; the title entries sit within the last turn, so the tail is enough. */
const CLAUDE_TAIL_BYTES = 4 * 1024 * 1024
const CODEX_TAIL_BYTES = 1024 * 1024

/**
 * When to look again after a hook. Claude names the session ~4 s after the first prompt, in parallel with the reply;
 * Codex names it after the first turn ends, as long as its title request takes.
 */
const CLAUDE_AFTER_PROMPT_MS = [3_000, 8_000, 20_000]
const CODEX_AFTER_STOP_MS = [0, 2_000, 6_000, 15_000, 30_000]

type Rec = Record<string, unknown>
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)

/** One line, no control characters, at most MAX_TITLE_CHARS code points; null when nothing is left. */
export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const line = raw.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim()
  if (line === '') return null
  const chars = [...line]
  return chars.length > MAX_TITLE_CHARS ? `${chars.slice(0, MAX_TITLE_CHARS).join('')}…` : line
}

function parseLine(line: string): Rec | null {
  try {
    const value: unknown = JSON.parse(line)
    return isRec(value) ? value : null
  } catch {
    return null
  }
}

/** Claude's display rule: the latest /rename wins over the latest generated title. */
export function parseClaudeTitle(text: string): string | null {
  let ai: string | null = null
  let custom: string | null = null
  for (const line of text.split('\n')) {
    if (!line.includes('-title"')) continue
    const entry = parseLine(line)
    if (entry?.type === 'custom-title') custom = cleanTitle(entry.customTitle) ?? custom
    else if (entry?.type === 'ai-title') ai = cleanTitle(entry.aiTitle) ?? ai
  }
  return custom ?? ai
}

/** The latest `thread_name` recorded for `threadId` (a rename appends another line). */
export function parseCodexTitle(text: string, threadId: string): string | null {
  let title: string | null = null
  for (const line of text.split('\n')) {
    if (!line.includes(threadId)) continue
    const entry = parseLine(line)
    if (entry?.id === threadId) title = cleanTitle(entry.thread_name) ?? title
  }
  return title
}

/** The last `maxBytes` of a file, starting at a line boundary. Missing / unreadable files read as ''. */
export async function readTail(path: string, maxBytes: number): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    const { size } = await handle.stat()
    const length = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    const text = buffer.toString('utf8')
    return length < size ? text.slice(text.indexOf('\n') + 1) : text
  } catch {
    return ''
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export interface AgentDataDirs {
  /** `projects` under $CLAUDE_CONFIG_DIR or ~/.claude. */
  claudeProjects: string[]
  /** $CODEX_HOME or ~/.codex. */
  codexHome: string
}

export function defaultAgentDataDirs(env: NodeJS.ProcessEnv = process.env, home = homedir()): AgentDataDirs {
  const claude = new Set([join(home, '.claude', 'projects')])
  if (env.CLAUDE_CONFIG_DIR && isAbsolute(env.CLAUDE_CONFIG_DIR)) claude.add(join(env.CLAUDE_CONFIG_DIR, 'projects'))
  const codexHome = env.CODEX_HOME && isAbsolute(env.CODEX_HOME) ? env.CODEX_HOME : join(home, '.codex')
  return { claudeProjects: [...claude], codexHome }
}

/** A transcript path from a hook payload, accepted only inside Claude's projects directory. */
export function claudeTranscriptPath(raw: unknown, dirs: AgentDataDirs): string | null {
  if (typeof raw !== 'string' || !isAbsolute(raw) || !raw.endsWith('.jsonl') || raw.includes('\0')) return null
  const path = normalize(raw)
  return dirs.claudeProjects.some((root) => path.startsWith(root + sep)) ? path : null
}

export type TitleReader = (path: string, maxBytes: number) => Promise<string>

interface Tracked {
  agent: HookAgent
  /** Claude: the transcript. */
  transcript?: string
  /** Codex: the thread id (`session_id`). */
  threadId?: string
  timers: unknown[]
  /** Last title sent for this session; only changes are emitted. */
  sent?: string
}

/**
 * Follows hook traffic and reports the agent's title whenever it changes. Electron-free: the glue supplies `emit`;
 * tests supply the reader and the scheduler.
 */
export class AgentTitleWatcher {
  private readonly sessions = new Map<string, Tracked>()
  private readonly dirs: AgentDataDirs
  private readonly read: TitleReader
  private readonly scheduler: Scheduler

  constructor(
    private readonly emit: (sessionId: string, agent: HookAgent, title: string) => void,
    options: { dirs?: AgentDataDirs; read?: TitleReader; scheduler?: Scheduler } = {}
  ) {
    this.dirs = options.dirs ?? defaultAgentDataDirs()
    this.read = options.read ?? readTail
    this.scheduler = options.scheduler ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) }
  }

  /** One hook call for an attached session. */
  observe(sessionId: string, agent: HookAgent, event: string, payload: unknown): void {
    if (!isRec(payload)) return
    let tracked = this.sessions.get(sessionId)
    if (!tracked || tracked.agent !== agent) {
      if (tracked) this.forget(sessionId)
      tracked = { agent, timers: [] }
      this.sessions.set(sessionId, tracked)
    }
    if (agent === 'claude') {
      const transcript = claudeTranscriptPath(payload.transcript_path, this.dirs)
      if (transcript) tracked.transcript = transcript
      // A resumed conversation already has its title; a new one gets it shortly after the first prompt.
      if (event === 'SessionStart' || event === 'Stop') this.schedule(sessionId, [0])
      else if (event === 'UserPromptSubmit') this.schedule(sessionId, CLAUDE_AFTER_PROMPT_MS)
    } else {
      if (isSafeAgentSessionId(payload.session_id)) tracked.threadId = payload.session_id
      if (event === 'Stop') this.schedule(sessionId, CODEX_AFTER_STOP_MS)
      else if (event === 'SessionStart' || event === 'UserPromptSubmit') this.schedule(sessionId, [0])
    }
  }

  /** The session's PTY ended or was re-spawned: stop looking. */
  forget(sessionId: string): void {
    const tracked = this.sessions.get(sessionId)
    if (!tracked) return
    for (const timer of tracked.timers) this.scheduler.clearTimeout(timer)
    this.sessions.delete(sessionId)
  }

  private schedule(sessionId: string, delays: number[]): void {
    const tracked = this.sessions.get(sessionId)
    if (!tracked) return
    for (const timer of tracked.timers) this.scheduler.clearTimeout(timer)
    tracked.timers = delays.map((ms) => this.scheduler.setTimeout(() => void this.check(sessionId, tracked), ms))
  }

  private async check(sessionId: string, tracked: Tracked): Promise<void> {
    let title: string | null = null
    if (tracked.agent === 'claude' && tracked.transcript) {
      title = parseClaudeTitle(await this.read(tracked.transcript, CLAUDE_TAIL_BYTES))
    } else if (tracked.agent === 'codex' && tracked.threadId) {
      title = parseCodexTitle(await this.read(join(this.dirs.codexHome, 'session_index.jsonl'), CODEX_TAIL_BYTES), tracked.threadId)
    }
    // Forgotten or replaced while reading: the answer belongs to a process that is gone.
    if (!title || this.sessions.get(sessionId) !== tracked || title === tracked.sent) return
    tracked.sent = title
    this.emit(sessionId, tracked.agent, title)
  }
}
