// DeviceSession / SimulatorHost lifecycle with a fake helper, stream and socket: who starts and stops the helper, when
// frames are read, and how failures and retries play out.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SimRuntimeGroup, SimulatorScreen } from '@shared/simulator'
import type { HostDeps, SimViewer } from './session'

const UDID = 'D08CB4F0-C5A9-47B3-B65E-B395108FF267'

interface FakeHelper {
  endpoints: { streamUrl: string; wsUrl: string; port: number }
  owned: boolean
  exited: Promise<void>
  stop: ReturnType<typeof vi.fn>
  exit(): void
}

const fakes = vi.hoisted(() => ({
  helpers: [] as FakeHelper[],
  streams: [] as { onFrame: (jpeg: Uint8Array) => void; onEnd: (error: Error | null) => void; stopped: boolean }[],
  sockets: [] as { sent: [number, object][]; closed: boolean }[],
  repairOk: true
}))

vi.mock('./helper', () => ({
  SimHelper: {
    start: vi.fn(async () => {
      let exit = () => {}
      const exited = new Promise<void>((resolve) => (exit = resolve))
      const helper: FakeHelper = {
        endpoints: { streamUrl: 'http://127.0.0.1:1/stream', wsUrl: 'ws://127.0.0.1:1/ws', port: 1 },
        owned: true,
        exited,
        stop: vi.fn(async () => exit()),
        exit: () => exit()
      }
      fakes.helpers.push(helper)
      return helper
    }),
    repairInput: vi.fn(async () => fakes.repairOk)
  }
}))

vi.mock('./stream', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./stream')>()
  class FrameStream {
    private readonly entry
    constructor(_url: string, onFrame: (jpeg: Uint8Array) => void, onEnd: (error: Error | null) => void) {
      this.entry = { onFrame, onEnd, stopped: false }
      fakes.streams.push(this.entry)
    }
    stop(): void {
      this.entry.stopped = true
    }
  }
  class InputSocket {
    private readonly entry = { sent: [] as [number, object][], closed: false }
    constructor() {
      fakes.sockets.push(this.entry)
    }
    send(tag: number, payload: object): void {
      this.entry.sent.push([tag, payload])
    }
    close(): void {
      this.entry.closed = true
    }
  }
  return { ...actual, FrameStream, InputSocket }
})

const { SimulatorHost } = await import('./session')

const IDLE_MS = 60_000
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

function devices(state: 'booted' | 'shutdown' = 'booted'): SimRuntimeGroup[] {
  return [{ runtime: 'iOS 26.3', devices: [{ udid: UDID, name: 'iPhone 17 Pro', state, runtime: 'iOS 26.3' }] }]
}

function viewer(): SimViewer & { screens: SimulatorScreen[]; frames: Uint8Array[]; last(): SimulatorScreen | undefined } {
  const screens: SimulatorScreen[] = []
  const frames: Uint8Array[] = []
  return { screens, frames, screen: (s) => screens.push(s), frame: (f) => frames.push(f), last: () => screens.at(-1) }
}

function deps(overrides: Partial<HostDeps> = {}): HostDeps {
  return {
    runtime: { execPath: '/bin/false', cliPath: '/dev/null', env: {} },
    listDevices: vi.fn(async () => devices()),
    boot: vi.fn(async () => {}),
    deviceHubHoldsInput: vi.fn(async () => false),
    idleStopMs: IDLE_MS,
    log: vi.fn(),
    ...overrides
  }
}

/** The i-th fake made so far (throws when there is none). */
function nth<T>(list: T[], i: number): T {
  const item = list[i]
  if (item === undefined) throw new Error(`no fake #${i}`)
  return item
}

/** Lets the session's async start (list → boot → helper) run. */
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  fakes.helpers.length = 0
  fakes.streams.length = 0
  fakes.sockets.length = 0
  fakes.repairOk = true
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SimulatorHost', () => {
  it('starts one helper per device, reads frames while shown and goes live on the first one', async () => {
    const host = new SimulatorHost(deps())
    const a = viewer()
    const b = viewer()
    host.show(a, UDID)
    host.show(b, UDID)
    await settle()
    expect(fakes.helpers).toHaveLength(1)
    expect(fakes.streams).toHaveLength(1)
    nth(fakes.streams, 0).onFrame(JPEG)
    expect(a.last()?.phase).toBe('live')
    expect(a.frames).toEqual([JPEG])
    expect(b.frames).toEqual([JPEG])
  })

  it('stops reading frames when the last viewer hides, and the helper an idle period later', async () => {
    const host = new SimulatorHost(deps())
    const a = viewer()
    const b = viewer()
    host.show(a, UDID)
    host.show(b, UDID)
    await settle()
    host.hide(a)
    expect(nth(fakes.streams, 0).stopped).toBe(false)
    host.hide(b)
    expect(nth(fakes.streams, 0).stopped).toBe(true)
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1)
    expect(nth(fakes.helpers, 0).stop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(nth(fakes.helpers, 0).stop).toHaveBeenCalledTimes(1)
    expect(nth(fakes.sockets, 0).closed).toBe(true)
  })

  it('keeps the helper when the device is shown again within the idle period', async () => {
    const host = new SimulatorHost(deps())
    const a = viewer()
    host.show(a, UDID)
    await settle()
    host.hide(a)
    await vi.advanceTimersByTimeAsync(IDLE_MS / 2)
    host.show(a, UDID)
    await vi.advanceTimersByTimeAsync(IDLE_MS)
    expect(fakes.helpers).toHaveLength(1)
    expect(nth(fakes.helpers, 0).stop).not.toHaveBeenCalled()
    // A new stream for the new show; the old one stays stopped.
    expect(fakes.streams.map((s) => s.stopped)).toEqual([true, false])
  })

  it('boots a shut-down device before starting its helper', async () => {
    const d = deps({ listDevices: vi.fn(async () => devices('shutdown')) })
    const host = new SimulatorHost(d)
    const a = viewer()
    host.show(a, UDID)
    await settle()
    expect(d.boot).toHaveBeenCalledWith(UDID)
    // (Later updates in the same phase, such as the Device Hub check, are folded.)
    const phases = a.screens.map((s) => s.phase).filter((p, i, all) => p !== all[i - 1])
    expect(phases).toEqual(['connecting', 'booting', 'connecting'])
    expect(fakes.helpers).toHaveLength(1)
  })

  it('fails with 找不到这台模拟器 when the device is not listed, and 没能连接 (logged) when simctl fails', async () => {
    const missing = new SimulatorHost(deps({ listDevices: vi.fn(async () => []) }))
    const a = viewer()
    missing.show(a, UDID)
    await settle()
    expect(a.last()).toMatchObject({ phase: 'failed', error: '找不到这台模拟器' })

    const log = vi.fn()
    const broken = new SimulatorHost(deps({ listDevices: vi.fn(async () => Promise.reject(new Error('simctl timed out'))), log }))
    const b = viewer()
    broken.show(b, UDID)
    await settle()
    expect(b.last()).toMatchObject({ phase: 'failed', error: '没能连接到模拟器' })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('simctl timed out'))
    expect(fakes.helpers).toHaveLength(0)
  })

  it('reconnects a lost stream, fails after five losses in a row, and retries in full when shown again', async () => {
    const host = new SimulatorHost(deps())
    const a = viewer()
    host.show(a, UDID)
    await settle()
    for (let i = 0; i < 5; i++) {
      fakes.streams.at(-1)?.onEnd(new Error('reset'))
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(fakes.streams).toHaveLength(6)
    expect(a.last()?.phase).toBe('connecting')
    fakes.streams.at(-1)?.onEnd(new Error('reset'))
    expect(a.last()).toMatchObject({ phase: 'failed', error: '模拟器已关闭' })
    expect(nth(fakes.helpers, 0).stop).toHaveBeenCalled()

    // 重新连接: a new helper, and its first lost stream is reconnected rather than failing at once.
    host.show(a, UDID)
    await settle()
    expect(fakes.helpers).toHaveLength(2)
    fakes.streams.at(-1)?.onEnd(new Error('reset'))
    expect(a.last()?.phase).toBe('connecting')
    await vi.advanceTimersByTimeAsync(500)
    expect(fakes.streams.at(-1)?.stopped).toBe(false)
  })

  it('fails with 模拟器已关闭 when its helper exits on its own', async () => {
    const host = new SimulatorHost(deps())
    const a = viewer()
    host.show(a, UDID)
    await settle()
    nth(fakes.helpers, 0).exit()
    await settle()
    expect(a.last()).toMatchObject({ phase: 'failed', error: '模拟器已关闭' })
  })

  it('stops a helper that finished starting after the device was stopped', async () => {
    let release = () => {}
    const host = new SimulatorHost(deps({ listDevices: () => new Promise<SimRuntimeGroup[]>((resolve) => (release = () => resolve(devices()))) }))
    const a = viewer()
    host.show(a, UDID)
    await host.stopAll()
    release()
    await settle()
    expect(fakes.helpers).toHaveLength(1)
    expect(nth(fakes.helpers, 0).stop).toHaveBeenCalled()
    expect(fakes.streams).toHaveLength(0)
  })

  it('restarts the helper after 修复输入 succeeds, while the device is shown', async () => {
    const host = new SimulatorHost(deps())
    const a = viewer()
    host.show(a, UDID)
    await settle()
    const repaired = host.of(a)?.repairInput()
    await settle()
    expect(await repaired).toBe(true)
    expect(nth(fakes.helpers, 0).stop).toHaveBeenCalled()
    expect(fakes.helpers).toHaveLength(2)
    expect(fakes.streams).toHaveLength(2)
  })

  it('sends input to the helper of the device the viewer shows', async () => {
    const host = new SimulatorHost(deps())
    const a = viewer()
    host.show(a, UDID)
    await settle()
    host.of(a)?.touch({ phase: 'begin', x: 0.5, y: 0.5, edge: 0 })
    host.of(a)?.key('down', 4)
    expect(nth(fakes.sockets, 0).sent.map(([, payload]) => payload)).toEqual([
      { type: 'begin', x: 0.5, y: 0.5 },
      { type: 'down', usage: 4 }
    ])
    host.hide(a)
    expect(host.of(a)).toBeNull()
  })
})
