// How main runs GUI sessions' agent processes (PRD F23): `PipeLink` is what src/main/gui uses. The pty daemon hosts
// them when it announces `pipes` in `welcome`, so a GUI session outlives the app like a TUI one; otherwise (an older
// daemon of the same protocol, or no daemon) they run in this process and end with the app, and the next launch
// resumes the conversation by id. Electron-free.
//
// src/main/pty sets one PipeLinkRouter at load: it waits for the host connection and sends each call to the current
// host's HostPipeLink, or to the in-process LocalPipeLink. Call `pipeLink()` for each use rather than keeping a link
// from before a host restart.

import { isCliAgent } from '@shared/agents'
import { PIPE_MAX_LINE_CHARS, PipeHost, type PipeExit, type PipeSpawn } from '../../pty-host/pipe-host'
import type { HookJournalEntry, HostEvent, HostRequest, HostSessionInfo } from '../../pty-host/protocol'

export interface PipeHandlers {
  line(line: string, seq: number): void
  exit(exit: PipeExit): void
}

export interface PipeAttach {
  pid: number
  seq: number
  lines: string[]
  truncated: boolean
  exit?: PipeExit
  /** Hook events the daemon journaled while no app was attached, oldest first (for src/main/hooks' adoptAgentSession). */
  hooks?: HookJournalEntry[]
  /** Requests already answered (a reply went to stdin); a replayed prompt for one of them is not shown again. */
  answered?: string[]
}

export type PipeSessionInfo = { id: string; pid: number; agent?: string; exit?: PipeExit }

export interface PipeLink {
  /** True when sessions outlive the app (the daemon hosts them). */
  readonly durable: boolean
  spawn(request: PipeSpawn, handlers: PipeHandlers): Promise<{ ok: true; pid: number } | { ok: false; message: string }>
  /** Reattaches to a session started before (by an earlier app run when durable); null when the host has none. */
  attach(id: string, handlers: PipeHandlers): Promise<PipeAttach | null>
  write(id: string, line: string): boolean
  kill(id: string): void
  /** Live pipe sessions the host holds (to adopt after a restart). */
  list(): Promise<PipeSessionInfo[]>
}

/** Pipe sessions in this process: the fallback, and what tests use. */
export class LocalPipeLink implements PipeLink {
  readonly durable = false
  private readonly handlers = new Map<string, PipeHandlers>()
  private readonly host = new PipeHost({
    line: (id, line, seq) => this.handlers.get(id)?.line(line, seq),
    exit: (id, exit) => this.handlers.get(id)?.exit(exit)
  })

  spawn(request: PipeSpawn, handlers: PipeHandlers): Promise<{ ok: true; pid: number } | { ok: false; message: string }> {
    this.handlers.set(request.id, handlers)
    const result = this.host.spawn(request)
    if (!result.ok) this.handlers.delete(request.id)
    return Promise.resolve(result)
  }

  attach(id: string, handlers: PipeHandlers): Promise<PipeAttach | null> {
    const snapshot = this.host.snapshot(id)
    if (!snapshot) return Promise.resolve(null)
    this.handlers.set(id, handlers)
    return Promise.resolve({
      pid: snapshot.pid,
      seq: snapshot.seq,
      lines: snapshot.lines,
      truncated: snapshot.truncated,
      ...(snapshot.exit ? { exit: snapshot.exit } : {}),
      answered: snapshot.answered
    })
  }

  write(id: string, line: string): boolean {
    return this.host.write(id, line)
  }

  kill(id: string): void {
    this.host.kill(id)
    this.handlers.delete(id)
  }

  list(): Promise<PipeSessionInfo[]> {
    return Promise.resolve(this.host.list())
  }

  has(id: string): boolean {
    return this.host.has(id)
  }

  killAll(): void {
    this.host.killAll()
    this.handlers.clear()
  }
}

/**
 * Where pipe sessions run for a host connection: in the daemon (outliving the app), in the fallback utilityProcess
 * (ending with the app), or in main itself when the daemon predates pipe sessions.
 */
export type PipeHosting = 'daemon' | 'utility' | 'main'

export function pipeHosting(host: { kind: 'daemon' | 'utility'; pipes?: boolean }): PipeHosting {
  if (host.kind === 'utility') return 'utility'
  return host.pipes === true ? 'daemon' : 'main'
}

export interface HostPipeTimeouts {
  spawnMs: number
  attachMs: number
  listMs: number
}

const DEFAULT_TIMEOUTS: HostPipeTimeouts = { spawnMs: 10_000, attachMs: 5_000, listMs: 5_000 }
const HOST_GONE = 'the agent host exited'

interface PendingSpawn {
  resolve(result: { ok: true; pid: number } | { ok: false; message: string }): void
  timer: ReturnType<typeof setTimeout>
}

interface PendingAttach {
  resolve(result: PipeAttach | null): void
  handlers: PipeHandlers
  timer: ReturnType<typeof setTimeout>
}

/**
 * Pipe sessions in the PTY host (the daemon or the utilityProcess fallback), over the same messages as the
 * terminals: `post` sends a request, and main hands every host event to `handleEvent` first. A session's events go
 * to the handlers of the spawn or attach that took it.
 */
export class HostPipeLink implements PipeLink {
  private readonly handlers = new Map<string, PipeHandlers>()
  private readonly spawns = new Map<string, PendingSpawn>()
  private readonly attaches = new Map<string, PendingAttach>()
  /** Spawns that timed out: their late `spawn-error` is still ours (main's terminal code would end a hook session). */
  private readonly abandoned = new Set<string>()
  private lists: Array<(sessions: PipeSessionInfo[]) => void> = []
  private gone = false

  constructor(
    private readonly post: (message: HostRequest) => void,
    readonly durable: boolean,
    private readonly timeouts: HostPipeTimeouts = DEFAULT_TIMEOUTS
  ) {}

  spawn(request: PipeSpawn, handlers: PipeHandlers): Promise<{ ok: true; pid: number } | { ok: false; message: string }> {
    if (this.gone) return Promise.resolve({ ok: false, message: HOST_GONE })
    const { id } = request
    this.takeSpawn(id)?.resolve({ ok: false, message: 'replaced by a newer spawn' })
    this.handlers.set(id, handlers)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.spawns.delete(id)
        this.handlers.delete(id)
        this.abandoned.add(id)
        // The host handles requests in order, so this ends the process it may still be starting.
        this.post({ type: 'kill', id })
        resolve({ ok: false, message: 'timed out starting the agent process' })
      }, this.timeouts.spawnMs)
      this.spawns.set(id, { resolve, timer })
      this.post({
        type: 'pipe-spawn',
        id,
        cwd: request.cwd,
        command: request.command,
        args: request.args,
        ...(isCliAgent(request.agent) ? { agent: request.agent } : {}),
        ...(request.env ? { env: request.env } : {}),
        ...(request.baseEnv ? { baseEnv: request.baseEnv } : {})
      })
    })
  }

  attach(id: string, handlers: PipeHandlers): Promise<PipeAttach | null> {
    if (this.gone) return Promise.resolve(null)
    this.takeAttach(id)?.resolve(null)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.attaches.delete(id)
        resolve(null)
      }, this.timeouts.attachMs)
      this.attaches.set(id, { resolve, handlers, timer })
      this.post({ type: 'pipe-attach', id })
    })
  }

  write(id: string, line: string): boolean {
    // Too long for one frame: the host would drop the whole connection (every terminal), so the message is refused.
    if (this.gone || !this.handlers.has(id) || line.includes('\n') || line.length > PIPE_MAX_LINE_CHARS) return false
    this.post({ type: 'pipe-write', id, line })
    return true
  }

  kill(id: string): void {
    this.handlers.delete(id)
    if (!this.gone) this.post({ type: 'kill', id })
  }

  list(): Promise<PipeSessionInfo[]> {
    if (this.gone) return Promise.resolve([])
    return new Promise((resolve) => {
      const done = (sessions: PipeSessionInfo[]): void => {
        clearTimeout(timer)
        resolve(sessions)
      }
      const timer = setTimeout(() => {
        this.lists = this.lists.filter((waiter) => waiter !== done)
        resolve([])
      }, this.timeouts.listMs)
      this.lists.push(done)
      this.post({ type: 'list' })
    })
  }

  /** Whether this link drives the session (spawned or attached here, still running). */
  owns(id: string): boolean {
    return this.handlers.has(id) || this.spawns.has(id)
  }

  /**
   * Takes the events that belong to pipe sessions; false for the rest (the terminals' events, and `sessions`, which
   * the terminals' own listing waits for too).
   */
  handleEvent(event: HostEvent): boolean {
    switch (event.type) {
      case 'pipe-spawned': {
        const pending = this.takeSpawn(event.id)
        this.abandoned.delete(event.id)
        // Late news of a spawn already given up on: end it rather than leave an agent nobody reads.
        if (pending) pending.resolve({ ok: true, pid: event.pid })
        else if (!this.handlers.has(event.id)) this.post({ type: 'kill', id: event.id })
        return true
      }
      case 'spawn-error': {
        const pending = this.takeSpawn(event.id)
        if (!pending) return this.abandoned.delete(event.id)
        this.handlers.delete(event.id)
        pending.resolve({ ok: false, message: event.message })
        return true
      }
      case 'pipe-line':
        this.handlers.get(event.id)?.line(event.line, event.seq)
        return true
      case 'pipe-exit': {
        const handlers = this.handlers.get(event.id)
        this.handlers.delete(event.id)
        handlers?.exit({ exitCode: event.exitCode, ...(event.signal !== undefined ? { signal: event.signal } : {}), stderr: event.stderr })
        return true
      }
      case 'pipe-attached': {
        const pending = this.takeAttach(event.id)
        if (!pending) {
          // Nobody waits for it any more (timed out, replaced): leave it running, unwatched.
          if (!event.exit) this.post({ type: 'detach', id: event.id })
          return true
        }
        if (!event.exit) this.handlers.set(event.id, pending.handlers)
        pending.resolve({
          pid: event.pid,
          seq: event.seq,
          lines: event.lines,
          truncated: event.truncated,
          ...(event.exit ? { exit: event.exit } : {}),
          ...(event.hooks ? { hooks: event.hooks } : {}),
          ...(Array.isArray(event.answered) ? { answered: event.answered.filter((id) => typeof id === 'string') } : {})
        })
        return true
      }
      case 'attach-miss': {
        const pending = this.takeAttach(event.id)
        if (!pending) return false
        pending.resolve(null)
        return true
      }
      case 'sessions': {
        const pipes = pipeSessionsOf(event.sessions)
        for (const done of this.lists.splice(0)) done(pipes)
        return false
      }
      default:
        return false
    }
  }

  /** The host died, and its pipe sessions with it: every waiter is answered and every session reports its end. */
  lost(): void {
    if (this.gone) return
    this.gone = true
    for (const id of [...this.spawns.keys()]) this.takeSpawn(id)?.resolve({ ok: false, message: HOST_GONE })
    for (const id of [...this.attaches.keys()]) this.takeAttach(id)?.resolve(null)
    for (const done of this.lists.splice(0)) done([])
    const handlers = [...this.handlers.values()]
    this.handlers.clear()
    for (const handler of handlers) handler.exit({ exitCode: -1, stderr: HOST_GONE })
  }

  private takeSpawn(id: string): PendingSpawn | undefined {
    const pending = this.spawns.get(id)
    if (!pending) return undefined
    clearTimeout(pending.timer)
    this.spawns.delete(id)
    return pending
  }

  private takeAttach(id: string): PendingAttach | undefined {
    const pending = this.attaches.get(id)
    if (!pending) return undefined
    clearTimeout(pending.timer)
    this.attaches.delete(id)
    return pending
  }
}

/** The pipe sessions of a host listing (`welcome.sessions`, `sessions`). */
export function pipeSessionsOf(sessions: HostSessionInfo[]): PipeSessionInfo[] {
  return sessions
    .filter((s) => s.pipe === true)
    .map((s) => ({
      id: s.id,
      pid: s.pid,
      ...(s.agent ? { agent: s.agent } : {}),
      // A listing carries no stderr; an attach returns it.
      ...(s.exit ? { exit: { exitCode: s.exit.exitCode, ...(s.exit.signal !== undefined ? { signal: s.exit.signal } : {}), stderr: '' } } : {})
    }))
}

export interface PipeLinkRouterOptions {
  /** Resolves once a host is connected (main's ensureHost); a failure leaves new sessions to `local`. */
  ready(): Promise<unknown>
  /** The connected host's link when it runs pipe sessions; null otherwise. */
  host(): HostPipeLink | null
  local: LocalPipeLink
}

/**
 * The one PipeLink main hands out: each call goes to the current host's link, or to `local` when the host does not
 * run pipe sessions (an older daemon). Sessions already in `local` stay there for this app run.
 */
export class PipeLinkRouter implements PipeLink {
  constructor(private readonly options: PipeLinkRouterOptions) {}

  get durable(): boolean {
    return this.options.host()?.durable ?? false
  }

  async spawn(request: PipeSpawn, handlers: PipeHandlers): Promise<{ ok: true; pid: number } | { ok: false; message: string }> {
    await this.ready()
    return (this.options.host() ?? this.options.local).spawn(request, handlers)
  }

  async attach(id: string, handlers: PipeHandlers): Promise<PipeAttach | null> {
    if (this.options.local.has(id)) return this.options.local.attach(id, handlers)
    await this.ready()
    return (await this.options.host()?.attach(id, handlers)) ?? null
  }

  write(id: string, line: string): boolean {
    if (this.options.local.has(id)) return this.options.local.write(id, line)
    return this.options.host()?.write(id, line) ?? false
  }

  kill(id: string): void {
    if (this.options.local.has(id)) this.options.local.kill(id)
    else this.options.host()?.kill(id)
  }

  async list(): Promise<PipeSessionInfo[]> {
    await this.ready()
    const host = this.options.host()
    return [...(host ? await host.list() : []), ...(await this.options.local.list())]
  }

  private async ready(): Promise<void> {
    try {
      await this.options.ready()
    } catch {
      // No host at all: pipe sessions run in main.
    }
  }
}

let current: PipeLink | null = null

/** The link GUI sessions use; src/main/pty sets a PipeLinkRouter over the host connection when it loads. */
export function pipeLink(): PipeLink {
  current ??= new LocalPipeLink()
  return current
}

export function setPipeLink(link: PipeLink): void {
  current = link
}
