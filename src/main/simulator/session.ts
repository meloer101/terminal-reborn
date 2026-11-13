// Which simulators are streamed to which windows (PRD F17 · iOS 模拟器). One DeviceSession per device: boots it when
// needed, owns its helper and input socket, reads frames only while some window shows it, and stops the helper a
// while after the last one stopped showing it. A simulator is never shut down here. No Electron imports, so the smoke
// script drives it in plain Node.
import {
  findDevice,
  ROTATE_RIGHT,
  type SimKeyPhase,
  type SimRuntimeGroup,
  type SimScroll,
  type SimTouch,
  type SimulatorScreen
} from '@shared/simulator'
import { SimHelper, type HelperRuntime } from './helper'
import { FrameStream, HID_TAG, InputSocket } from './stream'

/** A window's view of one simulator. */
export interface SimViewer {
  screen(screen: SimulatorScreen): void
  frame(jpeg: Uint8Array): void
}

export interface HostDeps {
  runtime: HelperRuntime
  listDevices(): Promise<SimRuntimeGroup[] | null>
  boot(udid: string): Promise<void>
  deviceHubHoldsInput(udid: string): Promise<boolean>
  /** How long a helper outlives the last view of its device. */
  idleStopMs: number
  log(line: string): void
}

const RECONNECT_MS = 500
/** Stream reconnects in a row without a frame before the device counts as gone. */
const MAX_STREAM_RETRIES = 5

/** Failures shown in the view; UI copy. */
const ERROR = {
  missing: '找不到这台模拟器',
  boot: '模拟器没能启动',
  helper: '没能连接到模拟器',
  stopped: '模拟器已关闭'
} as const

class DeviceSession {
  readonly viewers = new Set<SimViewer>()
  private screen: SimulatorScreen
  private helper: SimHelper | null = null
  private socket: InputSocket | null = null
  private stream: FrameStream | null = null
  private lastFrame: Uint8Array | null = null
  private starting = false
  /** Bumped by every teardown: async work started before it is ignored when it lands. */
  private generation = 0
  private streamRetries = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    readonly udid: string,
    private readonly deps: HostDeps,
    private readonly onIdle: () => void
  ) {
    this.screen = { udid, phase: 'connecting', width: 0, height: 0, orientation: 'portrait', inputBlocked: false, error: null }
  }

  attach(viewer: SimViewer): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    this.viewers.add(viewer)
    // Showing a failed device again is the retry.
    if (this.screen.phase === 'failed') this.update({ phase: 'connecting', error: null })
    viewer.screen(this.screen)
    if (this.lastFrame && this.screen.phase === 'live') viewer.frame(this.lastFrame)
    this.ensure()
  }

  detach(viewer: SimViewer): void {
    if (!this.viewers.delete(viewer)) return
    this.syncStream()
    if (this.viewers.size === 0 && !this.idleTimer) this.idleTimer = setTimeout(this.onIdle, this.deps.idleStopMs)
  }

  touch(touch: SimTouch): void {
    this.socket?.send(HID_TAG.touch, { type: touch.phase, x: touch.x, y: touch.y, ...(touch.edge ? { edge: touch.edge } : {}) })
  }

  scroll(scroll: SimScroll): void {
    this.socket?.send(HID_TAG.scroll, scroll)
  }

  key(phase: SimKeyPhase, usage: number): void {
    this.socket?.send(HID_TAG.key, { type: phase, usage })
  }

  home(): void {
    this.socket?.send(HID_TAG.button, { button: 'home' })
  }

  rotate(): void {
    this.socket?.send(HID_TAG.orientation, { orientation: ROTATE_RIGHT[this.screen.orientation] })
  }

  async repairInput(): Promise<boolean> {
    const ok = await SimHelper.repairInput(this.deps.runtime, this.udid)
    this.update({ inputBlocked: await this.deps.deviceHubHoldsInput(this.udid) })
    return ok
  }

  async dispose(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const helper = this.helper
    this.teardown()
    await helper?.stop()
  }

  private update(patch: Partial<SimulatorScreen>): void {
    this.screen = { ...this.screen, ...patch }
    for (const viewer of this.viewers) viewer.screen(this.screen)
  }

  private fail(error: string): void {
    this.teardown()
    this.update({ phase: 'failed', error })
  }

  /** Drops the connections (not the helper process: callers stop it when they mean to). */
  private teardown(): void {
    this.generation++
    this.stream?.stop()
    this.stream = null
    this.socket?.close()
    this.socket = null
    this.helper = null
    this.lastFrame = null
    this.starting = false
  }

  private ensure(): void {
    if (this.starting || this.screen.phase === 'failed') return
    if (this.helper) {
      this.syncStream()
      return
    }
    this.starting = true
    const generation = this.generation
    void this.start(generation).catch((error: unknown) => {
      if (generation !== this.generation) return
      this.deps.log(`[simulator] ${this.udid}: ${error instanceof Error ? error.message : String(error)}`)
      this.fail(error instanceof StartError ? error.copy : ERROR.helper)
    })
  }

  private async start(generation: number): Promise<void> {
    const devices = await this.deps.listDevices()
    const device = devices && findDevice(devices, this.udid)
    if (!device) throw new StartError(ERROR.missing)
    if (device.state !== 'booted') {
      this.update({ phase: 'booting' })
      try {
        await this.deps.boot(this.udid)
      } catch (error) {
        throw new StartError(ERROR.boot, error)
      }
      if (generation !== this.generation) return
      this.update({ phase: 'connecting' })
    }
    const helper = await SimHelper.start(this.deps.runtime, this.udid, (line) => this.deps.log(`[serve-sim] ${line}`))
    if (generation !== this.generation) {
      void helper.stop()
      return
    }
    this.helper = helper
    this.starting = false
    if (helper.owned) void helper.exited.then(() => this.helper === helper && this.fail(ERROR.stopped))
    this.connectSocket(generation)
    void this.deps.deviceHubHoldsInput(this.udid).then((blocked) => generation === this.generation && this.update({ inputBlocked: blocked }))
    this.syncStream()
  }

  private connectSocket(generation: number): void {
    const helper = this.helper
    if (!helper) return
    this.socket = new InputSocket(
      helper.endpoints.wsUrl,
      (config) => this.update({ width: config.width, height: config.height, orientation: config.orientation }),
      () => {
        if (generation !== this.generation) return
        this.socket = null
        setTimeout(() => generation === this.generation && this.helper === helper && this.connectSocket(generation), RECONNECT_MS)
      }
    )
  }

  /** Frames are read only while some window shows this device. */
  private syncStream(): void {
    const helper = this.helper
    if (this.viewers.size === 0 || !helper) {
      this.stream?.stop()
      this.stream = null
      return
    }
    if (this.stream) return
    const generation = this.generation
    this.stream = new FrameStream(
      helper.endpoints.streamUrl,
      (jpeg) => this.onFrame(jpeg),
      (error) => {
        if (generation !== this.generation) return
        this.stream = null
        if (++this.streamRetries > MAX_STREAM_RETRIES) {
          this.deps.log(`[simulator] ${this.udid}: stream ended${error ? `: ${error.message}` : ''}`)
          const stale = this.helper
          this.fail(ERROR.stopped)
          void stale?.stop()
          return
        }
        setTimeout(() => generation === this.generation && this.syncStream(), RECONNECT_MS)
      }
    )
  }

  private onFrame(jpeg: Uint8Array): void {
    this.streamRetries = 0
    this.lastFrame = jpeg
    if (this.screen.phase !== 'live') this.update({ phase: 'live', error: null })
    for (const viewer of this.viewers) viewer.frame(jpeg)
  }
}

class StartError extends Error {
  constructor(
    readonly copy: string,
    cause?: unknown
  ) {
    super(cause instanceof Error ? `${copy}: ${cause.message}` : copy)
  }
}

export class SimulatorHost {
  private readonly sessions = new Map<string, DeviceSession>()
  private readonly shown = new Map<SimViewer, DeviceSession>()

  constructor(private readonly deps: HostDeps) {}

  /** Shows `udid` in `viewer` (moving it off the device it showed before). */
  show(viewer: SimViewer, udid: string): void {
    const previous = this.shown.get(viewer)
    if (previous && previous.udid !== udid) previous.detach(viewer)
    let session = this.sessions.get(udid)
    if (!session) {
      session = new DeviceSession(udid, this.deps, () => void this.stop(udid))
      this.sessions.set(udid, session)
    }
    this.shown.set(viewer, session)
    session.attach(viewer)
  }

  hide(viewer: SimViewer): void {
    this.shown.get(viewer)?.detach(viewer)
    this.shown.delete(viewer)
  }

  /** The session `viewer` shows, for its input. */
  of(viewer: SimViewer): DeviceSession | null {
    return this.shown.get(viewer) ?? null
  }

  /** Stops every helper (app quit). */
  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((udid) => this.stop(udid)))
  }

  private async stop(udid: string): Promise<void> {
    const session = this.sessions.get(udid)
    if (!session) return
    this.sessions.delete(udid)
    for (const [viewer, shown] of this.shown) if (shown === session) this.shown.delete(viewer)
    await session.dispose()
  }
}
