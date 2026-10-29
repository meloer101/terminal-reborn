// Binds one XtermSurface to one PTY session through window.tr.pty.
import { AGENT_SPECS, type CliAgent } from '@shared/agents'
import { AGENT_MARKER_OSC, parseAgentMarker } from '@shared/agent-launch'
import { parseScriptMarker, SCRIPT_MARKER_OSC } from '@shared/script-launch'
import { QuietTimer } from '@shared/quiet-timer'
import type { AgentKind, SessionId } from '@shared/types'
import { handleTerminalLink, resolveSessionPaths } from '../state/link-actions'
import { emitAgentMarker, issueFromSpawnError, reportLaunchIssue } from '../lifecycle/launch-issues'
import { takeRunStart } from '../scripts/run-script'
import { forgetSetup, handleScriptMarker, takeSetup } from '../scripts/setup-runs'
import { loadLiveSessions, takeReattach } from './live-sessions'
import { uncovered } from './reattach-payload'
import { XtermSurface } from './xterm-surface'
import { openTerminalMenu } from '../attempts/terminal-menu'
import { takeDispatchLaunch } from '../dispatch/store'

const ACK_BATCH_UNITS = 32 * 1024
const ACK_FLUSH_MS = 50
/** The screen is saved once output has been quiet this long (never mid-redraw, so scrolling stays smooth). */
const SNAPSHOT_QUIET_MS = 3000

function dim(text: string): string {
  return `\r\n\x1b[2m${text}\x1b[0m\r\n`
}

/** Said in the terminal when the agent's CLI is not on the login shell's PATH (the shell prompt follows). */
const installHint = (kind: CliAgent): string => `[没有找到 ${AGENT_SPECS[kind].binary} 命令 · 安装：${AGENT_SPECS[kind].install}]`

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
  private readonly snapshotQuiet = new QuietTimer(SNAPSHOT_QUIET_MS, () =>
    requestIdleCallback(() => this.saveSnapshot(), { timeout: 2000 })
  )

  constructor(
    readonly sessionId: SessionId,
    private readonly cwd: string,
    private readonly agent: AgentKind = 'shell',
    /** Relaunch the agent into this earlier conversation instead of starting a new one. */
    private readonly resumeAgentSessionId?: string
  ) {
    // Links in the output open in the built-in browser, file paths in the 文件 view (PRD F17); the surface drops
    // the listener and the resolver when disposed.
    this.surface.onLink((link) => handleTerminalLink(sessionId, link))
    this.surface.setPathResolver((paths) => resolveSessionPaths(sessionId, paths))
    this.surface.onContextMenu((at) => void openTerminalMenu(sessionId, at))
  }

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
    // A process that kept running in the pty daemon (app quit, window reload) is reattached, never respawned.
    await loadLiveSessions()
    if (this.disposed) return
    if (takeReattach(id) && (await this.reattach())) return
    if (this.disposed) return

    // Paint the last screen right away; the process below takes a few seconds to draw anything.
    const snapshot = await window.tr.terminalSnapshots.load(id).catch(() => null)
    if (this.disposed) return
    if (snapshot) await this.surface.restore(snapshot)
    if (this.disposed) return

    this.listen()
    this.cleanups.push(
      pty.onData(id, (data) => {
        this.surface.write(data, () => this.ack(data.length))
        this.markDirty()
      })
    )
    await this.spawnProcess(this.resumeAgentSessionId)
  }

  /** Input, resize, exit and launch-marker listeners (output is wired by the caller). */
  private listen(): void {
    const pty = window.tr.pty
    const id = this.sessionId
    const input = this.surface.onInput((data) => this.sendInput(data))
    const resize = this.surface.onResize(({ cols, rows }) => pty.resize(id, cols, rows))
    // The launch script reports the agent's end (or a missing CLI) as an OSC marker; listening here, before the
    // spawn, means even an instant failure is seen (agent-launch.ts).
    const markers = this.surface.onOsc(AGENT_MARKER_OSC, (payload) => {
      const marker = parseAgentMarker(payload)
      if (!marker) return
      if (marker.type === 'missing' && this.agent !== 'shell') this.surface.write(dim(installHint(this.agent)))
      emitAgentMarker(id, marker)
    })
    // The repository's setup script reports through its own marker (PRD F4).
    const scriptMarkers = this.surface.onOsc(SCRIPT_MARKER_OSC, (payload) => {
      const marker = parseScriptMarker(payload)
      if (marker) handleScriptMarker(id, marker)
    })
    this.cleanups.push(
      pty.onExit(id, ({ exitCode }) => {
        this.exited = true
        this.surface.write(dim(`[进程已退出，退出码 ${exitCode}]`))
      }),
      () => input.dispose(),
      () => resize.dispose(),
      () => markers.dispose(),
      () => scriptMarkers.dispose()
    )
  }

  /**
   * Shows the daemon's screen of the still-running process and continues its live output from exactly there.
   * False when the daemon no longer has it (then the cold path spawns).
   */
  private async reattach(): Promise<boolean> {
    const pty = window.tr.pty
    const id = this.sessionId
    // Output can arrive before the screen does; hold it, and drop what the screen already shows.
    let covered: number | null = null
    const held: Array<[string, number]> = []
    const write = (data: string, seq: number): void => {
      if (covered === null) {
        held.push([data, seq])
        return
      }
      const fresh = uncovered(data, seq, covered)
      if (!fresh) return
      this.surface.write(fresh, () => this.ack(fresh.length))
      this.markDirty()
    }
    const offData = pty.onData(id, write)
    const result = await pty.attach(id).catch(() => null)
    if (!result || this.disposed) {
      offData()
      return false
    }
    this.cleanups.push(offData)
    await this.surface.reattach(result.screen)
    if (this.disposed) return true
    covered = result.seq
    for (const [data, seq] of held.splice(0)) write(data, seq)
    this.dirty = true
    if (result.exit) {
      this.exited = true
      this.surface.write(dim(`[进程已退出，退出码 ${result.exit.exitCode}]`))
      return true
    }
    this.listen()
    this.ready = true
    for (const data of this.queuedInput) pty.write(id, data)
    this.queuedInput = []
    // Now that resizes reach the PTY: fit the container (a different size makes the program redraw for it).
    this.surface.fit()
    return true
  }

  /** Spawns the PTY at the current size; false when it could not be started. */
  private async spawnProcess(resumeAgentSessionId?: string): Promise<boolean> {
    const pty = window.tr.pty
    const id = this.sessionId
    const { cols, rows } = this.surface.fit()
    // A new worktree's first launch runs the repository's setup script first; the Run button's terminal runs `run`.
    const script = takeSetup(id) ? 'setup' : takeRunStart(id) ? 'run' : undefined
    // A dispatched session's first launch carries its task on the command line (PRD F21); a resume never does.
    const dispatched = resumeAgentSessionId ? undefined : takeDispatchLaunch(id)
    try {
      await pty.spawn({
        sessionId: id,
        cwd: this.cwd,
        agent: this.agent,
        cols,
        rows,
        ...(resumeAgentSessionId ? { resumeAgentSessionId } : {}),
        ...(script ? { script } : {}),
        ...(dispatched ? { initialPrompt: dispatched.initialPrompt, ...(dispatched.model ? { model: dispatched.model } : {}) } : {})
      })
    } catch (error) {
      if (script === 'setup') forgetSetup(id)
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
    this.snapshotQuiet.touch()
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
    this.snapshotQuiet.cancel()
    for (const cleanup of this.cleanups) cleanup()
    if (this.started && !this.exited) window.tr.pty.kill(this.sessionId)
    this.surface.dispose()
  }
}
