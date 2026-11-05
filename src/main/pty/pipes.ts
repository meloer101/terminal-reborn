// How main runs GUI sessions' agent processes (PRD F23): `PipeLink` is what src/main/gui uses. The pty daemon hosts
// them when it announces `pipes` in `welcome`, so a GUI session outlives the app like a TUI one; otherwise (an older
// daemon of the same protocol, or no daemon) they run in this process and end with the app, and the next launch
// resumes the conversation by id. Electron-free.

import { PipeHost, type PipeExit, type PipeSpawn } from '../../pty-host/pipe-host'

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
}

export interface PipeLink {
  /** True when sessions outlive the app (the daemon hosts them). */
  readonly durable: boolean
  spawn(request: PipeSpawn, handlers: PipeHandlers): Promise<{ ok: true; pid: number } | { ok: false; message: string }>
  /** Reattaches to a session started before (by an earlier app run when durable); null when the host has none. */
  attach(id: string, handlers: PipeHandlers): Promise<PipeAttach | null>
  write(id: string, line: string): boolean
  kill(id: string): void
  /** Live pipe sessions the host holds (to adopt after a restart). */
  list(): Promise<{ id: string; pid: number; agent?: string; exit?: PipeExit }[]>
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
    return Promise.resolve({ pid: snapshot.pid, seq: snapshot.seq, lines: snapshot.lines, truncated: snapshot.truncated, ...(snapshot.exit ? { exit: snapshot.exit } : {}) })
  }

  write(id: string, line: string): boolean {
    return this.host.write(id, line)
  }

  kill(id: string): void {
    this.host.kill(id)
    this.handlers.delete(id)
  }

  list(): Promise<{ id: string; pid: number; agent?: string; exit?: PipeExit }[]> {
    return Promise.resolve(this.host.list())
  }

  killAll(): void {
    this.host.killAll()
    this.handlers.clear()
  }
}

let current: PipeLink | null = null

/** The link GUI sessions use; src/main/pty switches it to the daemon's once the daemon announces `pipes`. */
export function pipeLink(): PipeLink {
  current ??= new LocalPipeLink()
  return current
}

export function setPipeLink(link: PipeLink): void {
  current = link
}
