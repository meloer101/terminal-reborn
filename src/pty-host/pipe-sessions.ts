// The `pipe-*` requests (GUI sessions, PRD F23) over a PipeHost, with the same attach model as the PTYs in
// ./session-host: a client streams a session from spawn or attach until it detaches or goes away; meanwhile the
// process keeps running and its lines are kept for the next attach. A process that ends while nobody is attached is
// kept (with its last lines and stderr) for that attach, then forgotten. SessionHost owns one of these, so the daemon
// and the utilityProcess fallback handle pipe sessions on one code path.
import type { AgentKind } from '@shared/types'
import { PIPE_MAX_LINE_CHARS, PipeHost, type PipeExit } from './pipe-host'
import type { HostEvent, HostPipeSpawnRequest, HostRequest, HostSessionInfo } from './protocol'

export interface PipeSessionsOptions {
  emit(event: HostEvent): void
  /** A pipe session started, ended or was forgotten (the daemon's idle exit and hook journal follow it). */
  onSessionsChanged?: () => void
  log?: (message: string) => void
}

interface PipeRecord {
  attached: boolean
  agent?: AgentKind
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((item) => typeof item === 'string')

/** The daemon only takes requests from the authenticated app, but a malformed one must cost only itself. */
function validSpawn(request: HostPipeSpawnRequest): boolean {
  return (
    typeof request.cwd === 'string' &&
    typeof request.command === 'string' &&
    request.command.length > 0 &&
    isStringArray(request.args) &&
    (request.agent === undefined || typeof request.agent === 'string') &&
    (request.env === undefined || isStringRecord(request.env)) &&
    (request.baseEnv === undefined || isStringRecord(request.baseEnv))
  )
}

export class PipeSessions {
  private readonly records = new Map<string, PipeRecord>()
  // Lines go out over the daemon's socket (or the utilityProcess port): one too long for a frame is dropped and logged,
  // not sent to end the connection.
  private readonly host = new PipeHost(
    {
      line: (id, line, seq) => {
        if (this.records.get(id)?.attached) this.options.emit({ type: 'pipe-line', id, line, seq })
      },
      exit: (id, exit) => this.onExit(id, exit),
      dropped: (id, chars) => this.options.log?.(`pipe session ${id}: dropped a ${chars}-character stdout line (over ${PIPE_MAX_LINE_CHARS})`)
    },
    PIPE_MAX_LINE_CHARS
  )

  constructor(private readonly options: PipeSessionsOptions) {}

  /** Whether this request is for a pipe session: the `pipe-*` ones, and `kill` / `detach` of an id held here. */
  handles(message: HostRequest): boolean {
    switch (message.type) {
      case 'pipe-spawn':
      case 'pipe-write':
      case 'pipe-attach':
        return true
      case 'kill':
      case 'detach':
        return this.host.has(message.id)
      default:
        return false
    }
  }

  /** Handles a request `handles` accepted; anything else is ignored. */
  handle(message: HostRequest): void {
    switch (message.type) {
      case 'pipe-spawn':
        this.spawn(message)
        break
      case 'pipe-write':
        if (typeof message.line === 'string') this.host.write(message.id, message.line)
        break
      case 'pipe-attach':
        this.attach(message.id)
        break
      case 'kill':
        this.forget(message.id)
        break
      case 'detach': {
        const record = this.records.get(message.id)
        if (record) record.attached = false
        break
      }
      default:
        break
    }
  }

  /** Sessions held here (live, or ended while detached), marked `pipe`. */
  list(): HostSessionInfo[] {
    return this.host.list().map((s) => {
      const agent = this.records.get(s.id)?.agent
      return {
        id: s.id,
        pid: s.pid,
        ...(agent ? { agent } : {}),
        ...(s.exit ? { exit: { exitCode: s.exit.exitCode, ...(s.exit.signal !== undefined ? { signal: s.exit.signal } : {}) } } : {}),
        pipe: true
      }
    })
  }

  has(id: string): boolean {
    return this.host.has(id)
  }

  /** A client is streaming this live session. */
  isAttached(id: string): boolean {
    return this.records.get(id)?.attached === true && this.host.exitOf(id) === undefined
  }

  get liveCount(): number {
    return this.host.liveCount
  }

  /** The client went away: every session keeps running, its lines kept for the next attach. */
  detachAll(): void {
    for (const record of this.records.values()) record.attached = false
  }

  killAll(): void {
    const had = this.records.size > 0
    this.host.killAll()
    this.records.clear()
    if (had) this.options.onSessionsChanged?.()
  }

  private spawn(request: HostPipeSpawnRequest): void {
    if (!validSpawn(request)) {
      this.options.emit({ type: 'spawn-error', id: request.id, message: 'invalid pipe-spawn request' })
      return
    }
    // One that ended unseen was only kept for an attach; a new process under its id replaces it. A live one is never
    // replaced: the client attaches to it instead.
    if (this.host.exitOf(request.id)) this.forget(request.id)
    const result = this.host.spawn({
      id: request.id,
      cwd: request.cwd,
      command: request.command,
      args: request.args,
      ...(request.agent ? { agent: request.agent } : {}),
      ...(request.env ? { env: request.env } : {}),
      ...(request.baseEnv ? { baseEnv: request.baseEnv } : {})
    })
    if (!result.ok) {
      this.options.emit({ type: 'spawn-error', id: request.id, message: result.message })
      return
    }
    this.records.set(request.id, { attached: true, ...(request.agent ? { agent: request.agent } : {}) })
    this.options.emit({ type: 'pipe-spawned', id: request.id, pid: result.pid })
    this.options.onSessionsChanged?.()
  }

  private attach(id: string): void {
    const snapshot = this.host.snapshot(id)
    const record = this.records.get(id)
    if (!snapshot || !record) {
      this.options.emit({ type: 'attach-miss', id })
      return
    }
    // The host is synchronous: lines after this snapshot reach the client after `pipe-attached`, none in between.
    this.options.emit({
      type: 'pipe-attached',
      id,
      pid: snapshot.pid,
      ...(record.agent ? { agent: record.agent } : {}),
      seq: snapshot.seq,
      lines: snapshot.lines,
      truncated: snapshot.truncated,
      ...(snapshot.exit ? { exit: snapshot.exit } : {}),
      answered: snapshot.answered
    })
    // Like a PTY's last screen: an ended session is shown once, then gone.
    if (snapshot.exit) this.forget(id)
    else record.attached = true
  }

  private onExit(id: string, exit: PipeExit): void {
    // A killed (or replaced) process ending late: not the session now held under this id.
    if (this.host.exitOf(id) !== exit) return
    const record = this.records.get(id)
    if (record?.attached) {
      this.forget(id)
      this.options.emit({ type: 'pipe-exit', id, exitCode: exit.exitCode, ...(exit.signal !== undefined ? { signal: exit.signal } : {}), stderr: exit.stderr })
      return
    }
    this.options.onSessionsChanged?.()
  }

  /** Ends the process if it still runs and drops the session (no `pipe-exit` follows: the client asked for it). */
  private forget(id: string): void {
    if (!this.host.has(id)) return
    this.host.kill(id)
    this.records.delete(id)
    this.options.onSessionsChanged?.()
  }
}
