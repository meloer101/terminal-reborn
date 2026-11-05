// Pipe sessions (GUI sessions, PRD F23): agents with piped stdio speaking newline-delimited JSON. Used by the pty
// daemon (so a GUI session outlives the app like a TUI one) and by main's in-process fallback. Each session keeps
// its newest stdout lines for a client that attaches later. Node only (no Electron).

import { spawn, type ChildProcess } from 'node:child_process'
import { buildPtyEnv, resolveCwd, resolveShell } from './env'

/** Lines kept per session for `attach`, by total UTF-16 length. A GUI reattaching after a long run rebuilds older
 * history from the agent's transcript instead. */
export const PIPE_KEEP_CHARS = 16 * 1024 * 1024
const STDERR_KEEP_CHARS = 8 * 1024

/**
 * The longest line that crosses the pty daemon's socket either way (src/pty-daemon/wire.ts MAX_FRAME_CHARS, 64 Mi:
 * a bigger frame ends the whole connection, every terminal with it). A JSON line at most doubles when framed (`"` and
 * `\` are escaped again), so this leaves room for the envelope. main refuses to write longer ones (HostPipeLink) and
 * the host drops longer stdout lines (`maxLineChars`).
 */
export const PIPE_MAX_LINE_CHARS = 30 * 1024 * 1024

export interface PipeSpawn {
  id: string
  cwd: string
  agent?: string
  /** The command and its arguments; run with `exec` in the user's login shell so version managers put it on PATH. */
  command: string
  args: string[]
  env?: Record<string, string>
  baseEnv?: Record<string, string>
}

export interface PipeExit {
  exitCode: number
  signal?: number
  stderr: string
}

export interface PipeEvents {
  line(id: string, line: string, seq: number): void
  exit(id: string, exit: PipeExit): void
  /** A stdout line longer than `maxLineChars` was dropped (neither kept nor sent). */
  dropped?(id: string, chars: number): void
}

interface PipeSession {
  id: string
  agent?: string
  child: ChildProcess
  pid: number
  lines: string[]
  keptChars: number
  truncated: boolean
  seq: number
  stderr: string
  exit?: PipeExit
}

const quote = (word: string): string => (/^[A-Za-z0-9_./=:@%+-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`)

export class PipeHost {
  private readonly sessions = new Map<string, PipeSession>()

  constructor(
    private readonly events: PipeEvents,
    /** Longer stdout lines are dropped (a host behind the daemon's socket); no limit in main's own fallback. */
    private readonly maxLineChars = Number.POSITIVE_INFINITY
  ) {}

  spawn(request: PipeSpawn): { ok: true; pid: number } | { ok: false; message: string } {
    if (this.sessions.has(request.id)) return { ok: false, message: 'session already exists' }
    const env = buildPtyEnv(request.baseEnv ?? process.env, request.env)
    const shell = resolveShell(env)
    let child: ChildProcess
    try {
      // `-i` too, like the account probes: version managers often set PATH in the interactive rc only. Rc output on
      // stdout is not JSON and the drivers skip it.
      child = spawn(shell.command, [...shell.args, '-i', '-c', `exec ${[request.command, ...request.args].map(quote).join(' ')}`], {
        cwd: resolveCwd(request.cwd),
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    if (child.pid === undefined) return { ok: false, message: `could not start ${request.command}` }
    const session: PipeSession = { id: request.id, agent: request.agent, child, pid: child.pid, lines: [], keptChars: 0, truncated: false, seq: 0, stderr: '' }
    this.sessions.set(request.id, session)

    // The unfinished line; past `maxLineChars` it is dropped and the rest of it skipped (`skipped` counts it).
    let carry = ''
    let skipped = 0
    const take = (line: string): void => {
      if (skipped > 0) this.events.dropped?.(session.id, skipped + line.length)
      else if (line.length > this.maxLineChars) this.events.dropped?.(session.id, line.length)
      else if (line.trim()) this.keep(session, line.replace(/\r$/, ''))
      skipped = 0
    }
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (chunk: string) => {
      // Only the new chunk is searched: a multi-MB line is not rescanned per chunk.
      let start = 0
      let newline: number
      while ((newline = chunk.indexOf('\n', start)) >= 0) {
        const line = carry + chunk.slice(start, newline)
        carry = ''
        start = newline + 1
        take(line)
      }
      if (skipped > 0) skipped += chunk.length - start
      else carry += chunk.slice(start)
      if (carry.length > this.maxLineChars) {
        skipped = carry.length
        carry = ''
      }
    })
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (chunk: string) => {
      session.stderr = (session.stderr + chunk).slice(-STDERR_KEEP_CHARS)
    })
    // A write after the process ended must not crash the host.
    child.stdin!.on('error', () => undefined)
    child.once('error', (error) => {
      session.stderr = `${session.stderr}\n${error.message}`.slice(-STDERR_KEEP_CHARS)
    })
    child.once('close', (code, signal) => {
      if (carry || skipped > 0) take(carry)
      const exit: PipeExit = { exitCode: code ?? 1, ...(signal ? { signal: signalNumber(signal) } : {}), stderr: session.stderr }
      session.exit = exit
      this.events.exit(session.id, exit)
    })
    return { ok: true, pid: child.pid }
  }

  private keep(session: PipeSession, line: string): void {
    session.seq++
    session.lines.push(line)
    session.keptChars += line.length
    while (session.keptChars > PIPE_KEEP_CHARS && session.lines.length > 1) {
      session.keptChars -= session.lines.shift()!.length
      session.truncated = true
    }
    // A killed session's last lines must not reach a new session spawned under the same id.
    if (this.sessions.get(session.id) === session) this.events.line(session.id, line, session.seq)
  }

  write(id: string, line: string): boolean {
    const session = this.sessions.get(id)
    // One JSON message per line: a raw newline would split it.
    if (!session || session.exit || line.includes('\n') || !session.child.stdin || session.child.stdin.destroyed) return false
    session.child.stdin.write(`${line}\n`)
    return true
  }

  /** What a client that (re)attaches needs: the kept lines and where the stream continues. */
  snapshot(id: string): { pid: number; agent?: string; seq: number; lines: string[]; truncated: boolean; exit?: PipeExit } | null {
    const s = this.sessions.get(id)
    if (!s) return null
    return { pid: s.pid, ...(s.agent ? { agent: s.agent } : {}), seq: s.seq, lines: s.lines.slice(), truncated: s.truncated, ...(s.exit ? { exit: s.exit } : {}) }
  }

  kill(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    this.sessions.delete(id)
    if (!s.exit) {
      s.child.stdin?.end()
      s.child.kill('SIGTERM')
      setTimeout(() => {
        if (s.exit === undefined) s.child.kill('SIGKILL')
      }, 3000).unref()
    }
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }

  list(): { id: string; pid: number; agent?: string; exit?: PipeExit }[] {
    return [...this.sessions.values()].map((s) => ({ id: s.id, pid: s.pid, ...(s.agent ? { agent: s.agent } : {}), ...(s.exit ? { exit: s.exit } : {}) }))
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  /** The exit of the session now held under `id` (the very object passed to `events.exit`), if it ended. */
  exitOf(id: string): PipeExit | undefined {
    return this.sessions.get(id)?.exit
  }

  /** Sessions whose process still runs (the daemon's idle exit counts them). */
  get liveCount(): number {
    let n = 0
    for (const s of this.sessions.values()) if (!s.exit) n++
    return n
  }
}

function signalNumber(signal: NodeJS.Signals): number {
  const table: Partial<Record<NodeJS.Signals, number>> = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 }
  return table[signal] ?? 0
}
