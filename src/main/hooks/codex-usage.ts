// Codex's context window use and plan usage (PRD F11, §6.7). Codex has no statusLine; it writes a `token_count` event
// after every model response into its session rollout (`$CODEX_HOME/sessions/…/rollout-…-<thread>.jsonl`), the file
// every Codex hook payload names as `transcript_path`. After the hooks that follow a response we read its tail — only
// read, and only inside Codex's own sessions directory.
import { isAbsolute, join, normalize, sep } from 'node:path'
import type { HookAgent } from '@shared/agent-events'
import { lastCodexTokenCount, type MetaReading } from '@shared/session-meta'
import { defaultAgentDataDirs, readTail, type AgentDataDirs, type TitleReader } from './agent-title'
import type { Scheduler } from './permission-registry'

/** A turn's last token_count sits near the end; tool output after it can be long. */
const TAIL_BYTES = 512 * 1024
/**
 * When to read after a hook: Codex appends rollout lines from its own writer task, a moment after the event that
 * produced them, so a second look catches what the first one was too early for.
 */
const READ_AFTER_MS = [300, 2_000]
/** Hooks that come after a model response (SessionStart: a resumed conversation's last reading). */
const READ_ON: ReadonlySet<string> = new Set(['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop'])

/** A rollout path from a hook payload, accepted only under `$CODEX_HOME/sessions` (or `archived_sessions`). */
export function codexRolloutPath(raw: unknown, dirs: AgentDataDirs): string | null {
  if (typeof raw !== 'string' || !isAbsolute(raw) || !raw.endsWith('.jsonl') || raw.includes('\0')) return null
  const path = normalize(raw)
  const roots = [join(dirs.codexHome, 'sessions'), join(dirs.codexHome, 'archived_sessions')]
  return roots.some((root) => path.startsWith(root + sep)) ? path : null
}

interface Tracked {
  rollout?: string
  timers: unknown[]
}

export class CodexUsageWatcher {
  private readonly sessions = new Map<string, Tracked>()
  private readonly dirs: AgentDataDirs
  private readonly read: TitleReader
  private readonly scheduler: Scheduler
  private readonly now: () => number

  constructor(
    private readonly emit: (sessionId: string, reading: MetaReading) => void,
    options: { dirs?: AgentDataDirs; read?: TitleReader; scheduler?: Scheduler; now?: () => number } = {}
  ) {
    this.dirs = options.dirs ?? defaultAgentDataDirs()
    this.read = options.read ?? readTail
    this.scheduler = options.scheduler ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) }
    this.now = options.now ?? Date.now
  }

  observe(sessionId: string, agent: HookAgent, event: string, payload: unknown): void {
    if (agent !== 'codex' || typeof payload !== 'object' || payload === null) return
    let tracked = this.sessions.get(sessionId)
    if (!tracked) {
      tracked = { timers: [] }
      this.sessions.set(sessionId, tracked)
    }
    const rollout = codexRolloutPath((payload as { transcript_path?: unknown }).transcript_path, this.dirs)
    if (rollout) tracked.rollout = rollout
    if (!READ_ON.has(event) || !tracked.rollout) return
    for (const timer of tracked.timers) this.scheduler.clearTimeout(timer)
    const current = tracked
    tracked.timers = READ_AFTER_MS.map((ms) => this.scheduler.setTimeout(() => void this.check(sessionId, current), ms))
  }

  forget(sessionId: string): void {
    const tracked = this.sessions.get(sessionId)
    if (!tracked) return
    for (const timer of tracked.timers) this.scheduler.clearTimeout(timer)
    this.sessions.delete(sessionId)
  }

  private async check(sessionId: string, tracked: Tracked): Promise<void> {
    if (!tracked.rollout) return
    const reading = lastCodexTokenCount(await this.read(tracked.rollout, TAIL_BYTES), this.now())
    // Forgotten or replaced while reading: the answer belongs to a process that is gone.
    if (this.sessions.get(sessionId) !== tracked || (!reading.context && !reading.usage)) return
    this.emit(sessionId, reading)
  }
}
