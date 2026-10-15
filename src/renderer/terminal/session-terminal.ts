// Binds one XtermSurface to one PTY session through window.tr.pty.
import { AGENT_MARKER_OSC, parseAgentMarker } from '@shared/agent-launch'
import type { AgentKind, SessionId } from '@shared/types'
import { emitAgentMarker, issueFromSpawnError, reportLaunchIssue } from '../lifecycle/launch-issues'
import { XtermSurface } from './xterm-surface'

const ACK_BATCH_UNITS = 32 * 1024
const ACK_FLUSH_MS = 50

function dim(text: string): string {
  return `\r\n\x1b[2m${text}\x1b[0m\r\n`
}

export class SessionTerminal {
  readonly surface = new XtermSurface()
  private started = false
  private ready = false
  private exited = false
  private disposed = false
  private queuedInput: string[] = []
  private ackPending = 0
  private ackTimer: ReturnType<typeof setTimeout> | null = null
  private readonly cleanups: Array<() => void> = []

  constructor(
    readonly sessionId: SessionId,
    private readonly cwd: string,
    private readonly agent: AgentKind = 'shell',
    /** Relaunch the agent into this earlier conversation instead of starting a new one. */
    private readonly resumeAgentSessionId?: string
  ) {}

  /** The PTY is running (spawn requested, not exited, not disposed). */
  get alive(): boolean {
    return this.started && !this.exited && !this.disposed
  }

  /** Attaches to a container; the first call also starts the PTY at the fitted size. */
  attach(container: HTMLElement): void {
    this.surface.mount(container)
    if (this.started) return
    this.started = true
    void this.start()
  }

  private async start(): Promise<void> {
    const pty = window.tr.pty
    const id = this.sessionId
    await this.surface.whenOpen()
    if (this.disposed) return

    const input = this.surface.onInput((data) => this.sendInput(data))
    const resize = this.surface.onResize(({ cols, rows }) => pty.resize(id, cols, rows))
    // The launch script reports the agent's end (or a missing CLI) as an OSC marker; listening here, before the
    // spawn, means even an instant failure is seen (agent-launch.ts).
    const markers = this.surface.onOsc(AGENT_MARKER_OSC, (payload) => {
      const marker = parseAgentMarker(payload)
      if (marker) emitAgentMarker(id, marker)
    })
    this.cleanups.push(
      pty.onData(id, (data) => {
        this.surface.write(data, () => this.ack(data.length))
      }),
      pty.onExit(id, ({ exitCode }) => {
        this.exited = true
        this.surface.write(dim(`[进程已退出，退出码 ${exitCode}]`))
      }),
      () => input.dispose(),
      () => resize.dispose(),
      () => markers.dispose()
    )

    await this.spawnProcess(this.resumeAgentSessionId)
  }

  /** Spawns the PTY at the current size; false when it could not be started. */
  private async spawnProcess(resumeAgentSessionId?: string): Promise<boolean> {
    const pty = window.tr.pty
    const id = this.sessionId
    const { cols, rows } = this.surface.fit()
    try {
      await pty.spawn({
        sessionId: id,
        cwd: this.cwd,
        agent: this.agent,
        cols,
        rows,
        ...(resumeAgentSessionId ? { resumeAgentSessionId } : {})
      })
    } catch (error) {
      this.exited = true
      const message = error instanceof Error ? error.message : String(error)
      this.surface.write(dim(`[无法启动终端：${message}]`))
      // The lifecycle card says why (missing directory, spawn error) and the status moves to exited.
      reportLaunchIssue(id, issueFromSpawnError(error))
      return false
    }
    if (this.disposed) return false
    this.ready = true
    for (const data of this.queuedInput) pty.write(id, data)
    this.queuedInput = []
    return true
  }

  /**
   * Starts a fresh process in this terminal after the old one is gone (e.g. the pty-host died),
   * keeping the scrollback. Resolves to whether the new process started.
   */
  async restart(resumeAgentSessionId?: string): Promise<boolean> {
    if (this.disposed || !this.started) return false
    this.exited = false
    this.ready = false
    this.queuedInput = []
    // The dead process may have left the alternate screen, mouse reporting etc. switched on.
    this.surface.write('\x1b[?1049l\x1b[!p')
    this.surface.write(dim('[终端进程已重启]'))
    return this.spawnProcess(resumeAgentSessionId)
  }

  private sendInput(data: string): void {
    if (this.exited) return
    if (this.ready) window.tr.pty.write(this.sessionId, data)
    else this.queuedInput.push(data)
  }

  /** Tells the PTY host how much output has been parsed so it can keep reading (flow control). */
  private ack(units: number): void {
    this.ackPending += units
    if (this.ackPending >= ACK_BATCH_UNITS) this.flushAck()
    else this.ackTimer ??= setTimeout(() => this.flushAck(), ACK_FLUSH_MS)
  }

  private flushAck(): void {
    if (this.ackTimer !== null) clearTimeout(this.ackTimer)
    this.ackTimer = null
    if (this.ackPending === 0 || this.disposed) return
    window.tr.pty.ack(this.sessionId, this.ackPending)
    this.ackPending = 0
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.ackTimer !== null) clearTimeout(this.ackTimer)
    for (const cleanup of this.cleanups) cleanup()
    if (this.started && !this.exited) window.tr.pty.kill(this.sessionId)
    this.surface.dispose()
  }
}
