// Owns the node-pty sessions, independent of how requests arrive: the pty daemon (src/pty-daemon, Unix socket)
// and the fallback utilityProcess (./index.ts) both drive one of these with the messages in ./protocol.
import { accessSync, chmodSync, constants, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import * as nodePty from 'node-pty'
import { agentShellArgs } from '@shared/agent-launch'
import type { AgentKind } from '@shared/types'
import { OutputBatcher } from './batcher'
import { buildPtyEnv, resolveCwd, resolveShell } from './env'
import { FlowControl } from './flow-control'
import { guarded, type Logger } from './guard'
import { HeadlessMirror } from './headless-mirror'
import type { HostEvent, HostRequest, HostScreen, HostSessionInfo, HostSpawnRequest } from './protocol'

interface PtySession {
  proc: nodePty.IPty
  agent?: AgentKind
  batcher: OutputBatcher
  flow: FlowControl
  paused: boolean
  /** Output position (UTF-16 units received from the PTY). */
  seq: number
  /** A client wants this session's output. Detached sessions keep running; only the mirror sees their output. */
  attached: boolean
  /** Attaches waiting for their snapshot; output meanwhile is held so it goes out after the snapshot. */
  attaching: number
  held: HostEvent[]
  mirror: HeadlessMirror | null
  /** The process exited while detached: kept to show its last screen to the next client. */
  exit?: { exitCode: number; signal?: number }
}

export interface SessionHostOptions {
  emit(event: HostEvent): void
  /** Keep a headless mirror per session so a client can reattach (the daemon). */
  mirror: boolean
  /** The set of live sessions changed (spawn, exit); the daemon decides when to go idle from it. */
  onSessionsChanged?: () => void
  /** A session no client is attached to printed something (its screen changed unseen). */
  onDetachedOutput?: (id: string) => void
  log?: Logger
}

/**
 * node-pty's prebuilt spawn-helper ships without the executable bit on some installs.
 * `postinstall` fixes it before packaging; this is a dev-time fallback that only touches the
 * file when it really isn't executable, so a packaged (signed) bundle is never modified.
 */
export function ensureSpawnHelperExecutable(): void {
  try {
    const pkgDir = dirname(require.resolve('node-pty/package.json')).replace('app.asar', 'app.asar.unpacked')
    const helper = join(pkgDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
    try {
      accessSync(helper, constants.X_OK)
    } catch {
      chmodSync(helper, 0o755)
    }
  } catch {
    // Source builds have no prebuilds directory; nothing to fix.
  }
}

/** Codex keys trust by real path (spike §6), so /tmp → /private/tmp matters. */
function realpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

export class SessionHost {
  private readonly sessions = new Map<string, PtySession>()

  constructor(private readonly options: SessionHostOptions) {}

  private guard(label: string, fn: () => void): boolean {
    return guarded(label, fn, this.options.log)
  }

  /** Every per-session operation is guarded: a PTY that throws (EBADF, already exited, ...) only costs itself. */
  handle(message: HostRequest): void {
    switch (message.type) {
      case 'spawn':
        if (!this.guard(`spawn ${message.id}`, () => this.spawn(message))) {
          this.options.emit({ type: 'spawn-error', id: message.id, message: 'the terminal host failed to start the process' })
        }
        break
      case 'write':
        this.guard(`write ${message.id}`, () => this.live(message.id)?.proc.write(message.data))
        break
      case 'resize':
        // The PTY may have exited between the renderer's resize and now.
        this.guard(`resize ${message.id}`, () => {
          const session = this.live(message.id)
          if (!session) return
          session.proc.resize(message.cols, message.rows)
          session.mirror?.resize(message.cols, message.rows)
        })
        break
      case 'kill':
        this.guard(`kill ${message.id}`, () => {
          const session = this.sessions.get(message.id)
          if (session?.exit) this.remove(message.id, session)
          else session?.proc.kill()
        })
        break
      case 'ack':
        this.guard(`ack ${message.id}`, () => {
          const session = this.live(message.id)
          if (session?.attached && session.flow.onAck(message.count) && session.paused) this.resume(session)
        })
        break
      case 'visible':
        this.guard(`visible ${message.id}`, () => {
          const session = this.live(message.id)
          if (!session?.attached) return
          const next = session.flow.setVisible(message.visible)
          if (next === 'pause' && !session.paused) {
            session.paused = true
            session.proc.pause()
          } else if (next === 'resume' && session.paused) this.resume(session)
        })
        break
      case 'attach':
        this.guard(`attach ${message.id}`, () => this.attach(message.id))
        break
      case 'detach':
        this.guard(`detach ${message.id}`, () => {
          const session = this.live(message.id)
          if (session) this.detach(session)
        })
        break
      case 'list':
        this.options.emit({ type: 'sessions', sessions: this.list() })
        break
      case 'killAll':
        this.killAll()
        break
    }
  }

  /** Sessions the host holds (live, or exited while detached). */
  list(): HostSessionInfo[] {
    return [...this.sessions].map(([id, s]) => ({
      id,
      pid: s.proc.pid,
      ...(s.agent ? { agent: s.agent } : {}),
      ...(s.exit ? { exit: s.exit } : {})
    }))
  }

  /** A client is streaming this live session. */
  isAttached(id: string): boolean {
    return this.live(id)?.attached === true
  }

  /** The session's screen as its mirror has it (scrollback + screen, no modes); null without one. */
  async screen(id: string): Promise<HostScreen | null> {
    const mirror = this.sessions.get(id)?.mirror
    return mirror ? (await mirror.capture()).screen : null
  }

  /** Running processes. */
  get liveCount(): number {
    let count = 0
    for (const session of this.sessions.values()) if (!session.exit) count++
    return count
  }

  /** The client went away: every session keeps running, unseen until a client attaches again. */
  detachAll(): void {
    for (const session of this.sessions.values()) if (!session.exit) this.detach(session)
  }

  killAll(): void {
    for (const [id, session] of [...this.sessions]) this.destroy(id, session)
    this.options.onSessionsChanged?.()
  }

  private live(id: string): PtySession | undefined {
    const session = this.sessions.get(id)
    return session && !session.exit ? session : undefined
  }

  private spawn(request: HostSpawnRequest): void {
    const previous = this.sessions.get(request.id)
    if (previous) this.destroy(request.id, previous)

    const env = buildPtyEnv(request.baseEnv ?? process.env, request.env)
    const shell = resolveShell(env)
    const cwd = resolveCwd(request.cwd, homedir())
    const command = request.command ?? shell.command
    const args =
      request.command !== undefined
        ? (request.args ?? [])
        : request.agent && request.agent !== 'shell'
          ? agentShellArgs(request.agent, realpath(cwd), shell.command, {
              ...(request.claudeSettingsPath ? { claudeSettingsPath: request.claudeSettingsPath } : {}),
              ...(request.codexConfig ? { codexConfig: request.codexConfig } : {}),
              ...(request.resumeAgentSessionId ? { resumeAgentSessionId: request.resumeAgentSessionId } : {})
            })
          : shell.args

    let proc: nodePty.IPty
    try {
      proc = nodePty.spawn(command, args, {
        name: 'xterm-256color',
        cols: request.cols,
        rows: request.rows,
        cwd,
        env,
        encoding: 'utf8'
      })
    } catch (error) {
      this.options.emit({ type: 'spawn-error', id: request.id, message: error instanceof Error ? error.message : String(error) })
      return
    }

    const session: PtySession = {
      proc,
      ...(request.agent ? { agent: request.agent } : {}),
      batcher: new OutputBatcher((data) => this.emitData(request.id, session, data)),
      flow: new FlowControl(),
      paused: false,
      seq: 0,
      attached: true,
      attaching: 0,
      held: [],
      mirror: this.options.mirror ? new HeadlessMirror(request.cols, request.rows) : null
    }
    this.sessions.set(request.id, session)

    proc.onData((data) =>
      this.guard(`data ${request.id}`, () => {
        session.seq += data.length
        session.mirror?.write(data)
        if (!session.attached) {
          this.options.onDetachedOutput?.(request.id)
          return
        }
        session.batcher.append(data)
        if (session.flow.onOutput(data.length) && !session.paused) {
          session.paused = true
          proc.pause()
        }
      })
    )
    proc.onExit(({ exitCode, signal }) =>
      this.guard(`exit ${request.id}`, () => {
        this.guard(`flush ${request.id}`, () => session.batcher.flush())
        session.batcher.dispose()
        // A replaced session's late exit must not report on the new one.
        if (this.sessions.get(request.id) !== session) return
        const exit = { exitCode, ...(signal ? { signal } : {}) }
        if (session.attached || !session.mirror) {
          this.remove(request.id, session)
          this.emitOrHold(session, { type: 'exit', id: request.id, ...exit })
        } else {
          session.exit = exit
        }
        this.options.onSessionsChanged?.()
      })
    )
    this.options.emit({ type: 'spawned', id: request.id, pid: proc.pid })
    this.options.onSessionsChanged?.()
  }

  private attach(id: string): void {
    const session = this.sessions.get(id)
    if (!session?.mirror) {
      this.options.emit({ type: 'attach-miss', id })
      return
    }
    const mirror = session.mirror
    if (session.exit) {
      // The last screen of a process that ended while nobody watched; shown once, then the session is gone.
      this.sessions.delete(id)
      void mirror.capture().then(({ seq, screen }) => {
        mirror.dispose()
        this.options.emit({ type: 'attached', id, pid: session.proc.pid, ...agentOf(session), seq, screen, exit: session.exit })
      })
      return
    }
    // Whatever a previous client had not been sent yet is covered by the snapshot.
    session.batcher.dispose()
    session.attached = true
    this.resetFlow(session)
    session.attaching++
    void mirror.capture().then(({ seq, screen }) => {
      this.options.emit({ type: 'attached', id, pid: session.proc.pid, ...agentOf(session), seq, screen })
      session.attaching--
      if (session.attaching > 0) return
      const held = session.held
      session.held = []
      for (const event of held) this.options.emit(event)
    })
  }

  private detach(session: PtySession): void {
    session.attached = false
    session.batcher.dispose()
    session.held = []
    this.resetFlow(session)
  }

  private resetFlow(session: PtySession): void {
    session.flow = new FlowControl()
    if (session.paused) this.resume(session)
  }

  private resume(session: PtySession): void {
    session.paused = false
    session.proc.resume()
  }

  private emitData(id: string, session: PtySession, data: string): void {
    if (!session.attached) return
    this.emitOrHold(session, { type: 'data', id, data, seq: session.seq })
  }

  private emitOrHold(session: PtySession, event: HostEvent): void {
    if (session.attaching > 0) session.held.push(event)
    else this.options.emit(event)
  }

  private remove(id: string, session: PtySession): void {
    if (this.sessions.get(id) === session) this.sessions.delete(id)
    session.mirror?.dispose()
    session.mirror = null
  }

  private destroy(id: string, session: PtySession): void {
    this.remove(id, session)
    this.guard(`dispose ${id}`, () => session.batcher.dispose())
    // An already-gone process throws here; that is fine, but never let it escape.
    if (!session.exit) this.guard(`kill ${id}`, () => session.proc.kill())
  }
}

function agentOf(session: PtySession): { agent?: AgentKind } {
  return session.agent ? { agent: session.agent } : {}
}
