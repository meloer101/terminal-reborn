// The daemon's hook endpoint (PRD §6.8). Agents keep TR_HOOK_SOCK / TR_HOOK_TOKEN for life, so
// the socket lives with the daemon (stable path, persisted token) rather than with an app run. A hook for a session
// the app is attached to is relayed to the app, which turns it into events (src/main/hooks); otherwise it is answered
// at once (the agent is never slowed) and kept in the session's journal for the next attach.
import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { probeSocket, startHookServer, UnknownSessionError, type HookRequest, type HookServer } from '../main/hooks/server'
import type { HookJournalEntry } from '../pty-host/protocol'

export const JOURNAL_LIMIT = 64
/** Larger payloads are journaled without their body (status only needs the event and small fields). */
export const JOURNAL_PAYLOAD_MAX_CHARS = 64 * 1024
/** `TR_HOOKS_CHECK_MS` (inherited from the app) lets e2e fault-injection runs shorten the self-check. */
const CHECK_INTERVAL_MS = Number(process.env.TR_HOOKS_CHECK_MS) >= 100 ? Number(process.env.TR_HOOKS_CHECK_MS) : 30_000

export interface RelayReply {
  status: number
  body: string
}

/** Bounded per-session record of hook events nobody was attached to receive. */
export class HookJournal {
  private readonly entries = new Map<string, HookJournalEntry[]>()

  record(sessionId: string, entry: HookJournalEntry): void {
    let payload = entry.payload
    try {
      if (JSON.stringify(payload ?? null).length > JOURNAL_PAYLOAD_MAX_CHARS) payload = null
    } catch {
      payload = null
    }
    const list = this.entries.get(sessionId) ?? []
    list.push({ ...entry, payload })
    if (list.length > JOURNAL_LIMIT) list.splice(0, list.length - JOURNAL_LIMIT)
    this.entries.set(sessionId, list)
  }

  /** Hands the entries over (oldest first) and forgets them. */
  take(sessionId: string): HookJournalEntry[] {
    const list = this.entries.get(sessionId) ?? []
    this.entries.delete(sessionId)
    return list
  }

  /** Drops journals of sessions that are gone. */
  retain(live: ReadonlySet<string>): void {
    for (const id of [...this.entries.keys()]) if (!live.has(id)) this.entries.delete(id)
  }
}

function readOrCreateToken(path: string): string {
  try {
    const token = readFileSync(path, 'utf8').trim()
    if (/^[0-9a-f]{48}$/.test(token)) return token
  } catch {
    // Created below.
  }
  const token = randomBytes(24).toString('hex')
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, token, { mode: 0o600 })
  renameSync(tmp, path)
  return token
}

export interface DaemonHooksOptions {
  /** Where the socket goes (0700, created). */
  socketDir: string
  tokenPath: string
  /** Whether the daemon hosts this session at all (anything else is a foreign caller: 404). */
  known: (sessionId: string) => boolean
  /** Relays to the attached app; null when no app is attached to this session (then the hook is journaled). */
  relay: (request: HookRequest) => Promise<RelayReply> | null
  log: (...args: unknown[]) => void
}

export class DaemonHooks {
  readonly journal = new HookJournal()
  readonly token: string
  private server: HookServer | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly options: DaemonHooksOptions) {
    this.token = readOrCreateToken(options.tokenPath)
  }

  get socketPath(): string {
    return join(this.options.socketDir, 'hook.sock')
  }

  get running(): boolean {
    return this.server !== null
  }

  async start(): Promise<void> {
    await this.restart()
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const server = this.server
    this.server = null
    await server?.close().catch(() => undefined)
  }

  private async check(): Promise<void> {
    if (this.server && (await probeSocket(this.socketPath))) return
    this.options.log('hook socket is not reachable; restarting it')
    await this.restart().catch((error: unknown) => this.options.log('could not restart the hook socket', error))
  }

  private async restart(): Promise<void> {
    const old = this.server
    this.server = null
    await old?.close().catch(() => undefined)
    this.server = await startHookServer((request) => this.handle(request), {
      socketDir: this.options.socketDir,
      token: this.token,
      keepDir: true,
      onError: (error) => {
        this.options.log('hook server error', error)
        void this.check()
      }
    })
  }

  private async handle(request: HookRequest): Promise<string> {
    if (!this.options.known(request.sessionId)) throw new UnknownSessionError(request.sessionId)
    const relayed = this.options.relay(request)
    if (!relayed) {
      this.journal.record(request.sessionId, { event: request.event, agent: request.agent, payload: request.payload ?? null, at: Date.now() })
      return ''
    }
    const reply = await relayed
    if (reply.status === 404) throw new UnknownSessionError(request.sessionId)
    return reply.body
  }
}
