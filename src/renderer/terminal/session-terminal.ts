// Binds one XtermSurface to one PTY session through window.tr.pty.
import type { AgentKind, SessionId } from '@shared/types'
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
    this.cleanups.push(
      pty.onData(id, (data) => {
        this.surface.write(data, () => this.ack(data.length))
      }),
      pty.onExit(id, ({ exitCode }) => {
        this.exited = true
        this.surface.write(dim(`[进程已退出，退出码 ${exitCode}]`))
      }),
      () => input.dispose(),
      () => resize.dispose()
    )

    const { cols, rows } = this.surface.fit()
    try {
      await pty.spawn({
        sessionId: id,
        cwd: this.cwd,
        agent: this.agent,
        ...(this.resumeAgentSessionId ? { resumeAgentSessionId: this.resumeAgentSessionId } : {}),
        cols,
        rows
      })
    } catch (error) {
      this.exited = true
      const message = error instanceof Error ? error.message : String(error)
      this.surface.write(dim(`[无法启动终端：${message}]`))
      return
    }
    if (this.disposed) return
    this.ready = true
    for (const data of this.queuedInput) pty.write(id, data)
    this.queuedInput = []
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
