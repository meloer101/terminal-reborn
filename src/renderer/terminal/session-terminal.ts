// Binds one XtermSurface to one PTY session through window.tr.pty.
import { AGENT_MARKER_OSC, parseAgentMarker } from '@shared/agent-launch'
import type { AgentKind, SessionId } from '@shared/types'
import { emitAgentMarker, issueFromSpawnError, reportLaunchIssue } from '../lifecycle/launch-issues'
import { XtermSurface } from './xterm-surface'

const ACK_BATCH_UNITS = 32 * 1024
const ACK_FLUSH_MS = 50
/** The screen is saved once output has been quiet this long (never mid-redraw, so scrolling stays smooth). */
const SNAPSHOT_QUIET_MS = 3000

function dim(text: string): string {
  return `\r\n\x1b[2m${text}\x1b[0m\r\n`
}

/** Said in the terminal when the agent's CLI is not on the login shell's PATH (the shell prompt follows). */
const INSTALL_HINT: Record<Exclude<AgentKind, 'shell'>, string> = {
  claude: '[没有找到 claude 命令 · 安装：npm install -g @anthropic-ai/claude-code]',
  codex: '[没有找到 codex 命令 · 安装：npm install -g @openai/codex]'
}

export class SessionTerminal {
  readonly surface = new XtermSurface()
  private started = false
  private ready = false
  private exited = false
  private disposed = false
  private queuedInput: string[] = []
  private inputBuffer = ''
  private ackPending = 0
  private ackTimer: ReturnType<typeof setTimeout> | null = null
  private readonly cleanups: Array<() => void> = []
  /** Output arrived since the last snapshot. */
  private dirty = false
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null

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
    // Paint the last screen right away; the process below takes a few seconds to draw anything.
    const snapshot = window.tr.terminalSnapshots.loadSync(id)
    if (snapshot) await this.surface.restore(snapshot)
    if (this.disposed) return

    const input = this.surface.onInput((data) => this.sendInput(data))
    const resize = this.surface.onResize(({ cols, rows }) => pty.resize(id, cols, rows))
    // The launch script reports the agent's end (or a missing CLI) as an OSC marker; listening here, before the
    // spawn, means even an instant failure is seen (agent-launch.ts).
    const markers = this.surface.onOsc(AGENT_MARKER_OSC, (payload) => {
      const marker = parseAgentMarker(payload)
      if (!marker) return
      if (marker.type === 'missing' && this.agent !== 'shell') this.surface.write(dim(INSTALL_HINT[this.agent]))
      emitAgentMarker(id, marker)
    })
    this.cleanups.push(
      pty.onData(id, (data) => {
        this.surface.write(data, () => this.ack(data.length))
        this.markDirty()
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
      const issue = issueFromSpawnError(error)
      this.surface.write(dim(issue.kind === 'cwd-missing' ? `[项目目录不存在：${issue.path}]` : `[无法启动终端：${issue.kind === 'spawn-failed' ? issue.message : String(error)}]`))
      // The status moves to exited (sidebar, header).
      reportLaunchIssue(id, issue)
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

  /** Redraws the terminal and tells the PTY its exact size again, so the program draws for the grid we show. */
  resync(): void {
    if (this.disposed) return
    const { cols, rows } = this.surface.repaint()
    if (this.ready && !this.exited) window.tr.pty.resize(this.sessionId, cols, rows)
  }

  private sendInput(data: string): void {
    if (this.exited) return
    if (!this.ready) {
      this.queuedInput.push(data)
      return
    }
    // Input produced in the same task (a burst of wheel reports, a paste split by xterm) goes out as one write,
    // so a full-screen agent applies a scroll gesture in one redraw instead of replaying it report by report.
    if (this.inputBuffer === '') queueMicrotask(() => this.flushInput())
    this.inputBuffer += data
  }

  private flushInput(): void {
    const data = this.inputBuffer
    this.inputBuffer = ''
    if (data && this.ready && !this.exited && !this.disposed) window.tr.pty.write(this.sessionId, data)
  }

  private markDirty(): void {
    this.dirty = true
    if (this.snapshotTimer !== null) clearTimeout(this.snapshotTimer)
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null
      requestIdleCallback(() => this.saveSnapshot(), { timeout: 2000 })
    }, SNAPSHOT_QUIET_MS)
  }

  /** Saves what the terminal shows, if it changed since the last save. */
  saveSnapshot(): void {
    if (!this.dirty || this.disposed) return
    const snapshot = this.surface.snapshot()
    if (!snapshot) return
    this.dirty = false
    window.tr.terminalSnapshots.save(this.sessionId, snapshot)
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

  /** `forget`: the session itself is gone, so its saved screen goes too. */
  dispose(forget = false): void {
    if (this.disposed) return
    if (forget) window.tr.terminalSnapshots.remove(this.sessionId)
    else this.saveSnapshot()
    this.disposed = true
    if (this.ackTimer !== null) clearTimeout(this.ackTimer)
    if (this.snapshotTimer !== null) clearTimeout(this.snapshotTimer)
    for (const cleanup of this.cleanups) cleanup()
    if (this.started && !this.exited) window.tr.pty.kill(this.sessionId)
    this.surface.dispose()
  }
}
