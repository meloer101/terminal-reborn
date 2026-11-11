// Claude's workflow runs in a terminal session (ultracode, PRD F25, Figma 74D): read from the run's own files after
// hooks, as subagents.ts does for subagents. A run starts with the Workflow call's PostToolUse (its result names the
// run id); while it goes, `subagents/workflows/<runId>/journal.jsonl` says which agents started and ended (queued ones
// are not there yet, so the run is `partial`); when it ends, `workflows/<runId>.json` has the whole run. Files are
// only read, and only beside a transcript under Claude's projects directory. GUI sessions are skipped: their
// stream-json carries the same rows live (gui/claude-driver.ts). Measured on 2.1.322 (PRD §6.20).
import { open, readdir } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { HookAgent } from '@shared/agent-events'
import { isLiveRun, runFromJournal, runFromSnapshot, scriptMeta, WORKFLOW_RUN_ID, type WorkflowPhase, type WorkflowRun } from '@shared/workflow-run'
import { claudeTranscriptPath, defaultAgentDataDirs, type AgentDataDirs } from './agent-title'
import { readHead } from './codex-usage'

type Rec = Record<string, unknown>
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/** The snapshot holds every row: read whole, up to this much. */
const MAX_BYTES = 8 * 1024 * 1024
/**
 * The journal holds every agent's result and only grows: it is read on from where the last read stopped, this much at a
 * time, and only each line's few fields are kept.
 */
const JOURNAL_CHUNK = 1024 * 1024
/** Hooks of a running run's agents come many a second: its journal is read at most this often. */
const READ_EVERY_MS = 1_500
/** A snapshot not written yet when the run's end is heard: read again this many times, this far apart. */
const END_RETRIES = 4
const END_RETRY_MS = 1_500
/** Runs kept per session (ended ones stay for the card until the conversation restarts). */
const MAX_RUNS = 10

export interface WorkflowFiles {
  read(path: string, maxBytes: number): Promise<string | null>
  /** Up to `maxBytes` from byte `offset`; null when the file cannot be read. */
  readFrom(path: string, offset: number, maxBytes: number): Promise<Buffer | null>
  list(dir: string): Promise<string[]>
}

export const nodeWorkflowFiles: WorkflowFiles = {
  // A file that is not there (yet) reads as ''.
  read: async (path, maxBytes) => (await readHead(path, maxBytes)) || null,
  async readFrom(path, offset, maxBytes) {
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(path, 'r')
      const buffer = Buffer.alloc(Math.max(0, Math.min((await handle.stat()).size - offset, maxBytes)))
      if (buffer.length === 0) return buffer
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
      return buffer.subarray(0, bytesRead)
    } catch {
      return null
    } finally {
      await handle?.close().catch(() => undefined)
    }
  },
  async list(dir) {
    try {
      return await readdir(dir)
    } catch {
      return []
    }
  }
}

interface Run {
  run: WorkflowRun
  phases: WorkflowPhase[]
  ended: boolean
  reading: boolean
  readAt: number
  /** Snapshot re-reads left once the end was heard. */
  endRetries: number
  /** The journal: bytes read so far (whole lines), and its lines cut to the fields the run needs. */
  offset: number
  lines: string[]
  /** A line longer than a chunk is being skipped (one agent's huge result): drop up to its end. */
  skipping: boolean
}

/** A journal line with only what `runFromJournal` reads (a result's payload can be megabytes). */
function compactLine(line: string): string | null {
  try {
    const entry: unknown = JSON.parse(line)
    if (!isRec(entry) || typeof entry.type !== 'string') return null
    const { type, key, agentId, label, phase } = entry
    return JSON.stringify({ type, key, agentId, label, phase })
  } catch {
    return null
  }
}

interface Tracked {
  /** The session transcript (`<projects>/<slug>/<session>.jsonl`); its folder holds the runs. */
  transcript?: string
  runs: Map<string, Run>
  sent: string
}

/** The Workflow call's result (2.1.322 `toolUseResult`): `{ status: 'async_launched', runId, taskId, workflowName, … }`. */
export function launchedRun(payload: Rec): { runId: string; name?: string; toolUseId?: string; phases: WorkflowPhase[] } | null {
  if (payload.tool_name !== 'Workflow') return null
  const response = isRec(payload.tool_response) ? payload.tool_response : null
  const runId = str(response?.runId)
  if (!runId || !WORKFLOW_RUN_ID.test(runId)) return null
  const input = isRec(payload.tool_input) ? payload.tool_input : {}
  const meta = typeof input.script === 'string' ? scriptMeta(input.script) : null
  const name = str(response?.workflowName) ?? meta?.name ?? str(input.name)
  const toolUseId = str(payload.tool_use_id)
  return { runId, ...(name ? { name } : {}), ...(toolUseId ? { toolUseId } : {}), phases: meta?.phases ?? [] }
}

/**
 * Follows a Claude session's hooks and reports its workflow runs whenever they change. Electron-free: the glue supplies
 * `emit`; tests supply the files and the clock.
 */
export class WorkflowWatcher {
  private readonly sessions = new Map<string, Tracked>()
  private readonly dirs: AgentDataDirs
  private readonly files: WorkflowFiles
  private readonly now: () => number
  private readonly schedule: (fn: () => void, ms: number) => void
  private readonly skip: (sessionId: string) => boolean

  constructor(
    private readonly emit: (sessionId: string, agent: HookAgent, runs: WorkflowRun[]) => void,
    options: { dirs?: AgentDataDirs; files?: WorkflowFiles; now?: () => number; schedule?: (fn: () => void, ms: number) => void; skip?: (sessionId: string) => boolean } = {}
  ) {
    this.dirs = options.dirs ?? defaultAgentDataDirs()
    this.files = options.files ?? nodeWorkflowFiles
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? ((fn, ms) => void setTimeout(fn, ms).unref())
    this.skip = options.skip ?? (() => false)
  }

  observe(sessionId: string, agent: HookAgent, event: string, payload: unknown): void {
    if (agent !== 'claude' || !isRec(payload) || this.skip(sessionId)) return
    let tracked = this.sessions.get(sessionId)
    if (!tracked) {
      tracked = { runs: new Map(), sent: '' }
      this.sessions.set(sessionId, tracked)
    }
    const transcript = claudeTranscriptPath(payload.transcript_path, this.dirs)
    if (transcript && !transcript.includes(`${sep}subagents${sep}`)) tracked.transcript = transcript

    if (event === 'SessionStart' && payload.source !== 'compact') {
      // A new, cleared or resumed conversation: its runs are another transcript's.
      if (tracked.runs.size > 0) {
        tracked.runs.clear()
        this.publish(sessionId, tracked)
      }
      return
    }
    const launched = event === 'PostToolUse' ? launchedRun(payload) : null
    if (launched) {
      if (!tracked.runs.has(launched.runId)) {
        for (const key of [...tracked.runs.keys()].slice(0, Math.max(0, tracked.runs.size - MAX_RUNS + 1))) tracked.runs.delete(key)
        tracked.runs.set(launched.runId, {
          run: {
            key: launched.runId,
            runId: launched.runId,
            ...(launched.toolUseId ? { toolUseId: launched.toolUseId } : {}),
            name: launched.name ?? launched.runId,
            status: 'running',
            phases: launched.phases,
            agents: [],
            startedAt: this.now(),
            partial: true
          },
          phases: launched.phases,
          ended: false,
          reading: false,
          readAt: -Infinity,
          endRetries: END_RETRIES,
          offset: 0,
          lines: [],
          skipping: false
        })
        this.publish(sessionId, tracked)
      }
      return
    }
    // A workflow agent we have no run for (the PostToolUse was lost, or Wavi started after it): find its run.
    if (payload.agent_type === 'workflow-subagent' && ![...tracked.runs.values()].some((r) => !r.ended)) void this.discover(sessionId, tracked)
    // The main thread's turn ended or it was woken by a finished task, or a subagent ended: a run may have ended.
    const maybeEnded = event === 'Stop' || event === 'SubagentStop' || (event === 'UserPromptSubmit' && payload.source === 'system')
    for (const entry of tracked.runs.values()) {
      if (entry.ended) continue
      if (maybeEnded) entry.endRetries = END_RETRIES
      if (!entry.reading && (maybeEnded || this.now() - entry.readAt >= READ_EVERY_MS)) void this.read(sessionId, tracked, entry)
    }
  }

  forget(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  private base(tracked: Tracked): string | null {
    return tracked.transcript ? tracked.transcript.slice(0, -'.jsonl'.length) : null
  }

  private async discover(sessionId: string, tracked: Tracked): Promise<void> {
    const base = this.base(tracked)
    if (!base) return
    const ids = (await this.files.list(join(base, 'subagents', 'workflows'))).filter((id) => WORKFLOW_RUN_ID.test(id) && !tracked.runs.has(id))
    if (ids.length === 0 || this.sessions.get(sessionId) !== tracked) return
    for (const runId of ids.slice(-MAX_RUNS)) {
      const entry: Run = {
        run: { key: runId, runId, name: runId, status: 'running', phases: [], agents: [], partial: true },
        phases: [],
        ended: false,
        reading: false,
        readAt: -Infinity,
        endRetries: 0,
        offset: 0,
        lines: [],
        skipping: false
      }
      tracked.runs.set(runId, entry)
      void this.read(sessionId, tracked, entry)
    }
  }

  private async read(sessionId: string, tracked: Tracked, entry: Run): Promise<void> {
    const base = this.base(tracked)
    const runId = entry.run.runId
    if (!base || !runId) return
    entry.reading = true
    entry.readAt = this.now()
    let next: WorkflowRun | null = null
    try {
      const snapshot = await this.files.read(join(base, 'workflows', `${runId}.json`), MAX_BYTES)
      if (snapshot) {
        try {
          next = runFromSnapshot(JSON.parse(snapshot))
        } catch {
          next = null // being written
        }
      }
      if (!next && (await this.readJournal(join(base, 'subagents', 'workflows', runId, 'journal.jsonl'), entry))) {
        next = runFromJournal(entry.lines.join('\n'), { runId, name: entry.run.name, phases: entry.phases })
      }
    } finally {
      entry.reading = false
    }
    if (this.sessions.get(sessionId) !== tracked || tracked.runs.get(runId) !== entry || !next) return
    const toolUseId = entry.run.toolUseId
    entry.run = { ...next, ...(toolUseId ? { toolUseId } : {}), ...(next.startedAt === undefined && entry.run.startedAt !== undefined ? { startedAt: entry.run.startedAt } : {}) }
    entry.ended = !isLiveRun(entry.run)
    this.publish(sessionId, tracked)
    // Its end was heard but the snapshot was not there yet: look again shortly.
    if (!entry.ended && entry.endRetries > 0) {
      entry.endRetries -= 1
      this.schedule(() => {
        if (this.sessions.get(sessionId) === tracked && tracked.runs.get(runId) === entry && !entry.ended && !entry.reading) void this.read(sessionId, tracked, entry)
      }, END_RETRY_MS)
    }
  }

  /** Reads the journal on from where it stopped; false when it cannot be read (not there yet). */
  private async readJournal(path: string, entry: Run): Promise<boolean> {
    for (;;) {
      const chunk = await this.files.readFrom(path, entry.offset, JOURNAL_CHUNK)
      if (!chunk) return false
      const end = chunk.lastIndexOf(0x0a)
      if (end < 0) {
        // No whole line yet: a line being written, or one longer than a chunk (skipped to its end).
        if (chunk.length === JOURNAL_CHUNK) {
          entry.offset += chunk.length
          entry.skipping = true
          continue
        }
        return true
      }
      const text = chunk.subarray(0, end).toString('utf8').split('\n')
      if (entry.skipping) {
        text.shift()
        entry.skipping = false
      }
      for (const line of text) {
        const kept = line.trim() ? compactLine(line) : null
        if (kept) entry.lines.push(kept)
      }
      entry.offset += end + 1
      if (chunk.length < JOURNAL_CHUNK) return true
    }
  }

  private publish(sessionId: string, tracked: Tracked): void {
    const runs = [...tracked.runs.values()].map((r) => r.run)
    const key = JSON.stringify(runs)
    if (key === tracked.sent) return
    tracked.sent = key
    this.emit(sessionId, 'claude', runs)
  }
}
