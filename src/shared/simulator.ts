// The right panel's iOS 模拟器 view (PRD F17 · Figma 76C / 76D): one simulator, streamed and driven through main, which
// runs serve-sim (Apache-2.0) as a helper per device. Pure: simctl parsing, the MJPEG part parser, key and pointer
// mapping; shared by main and the renderer.
//
// The orientation geometry below (displayGeometry, rawPoint, rawDelta, rawEdge, ROTATE_RIGHT, HOME_INDICATOR_BAND) is
// adapted from serve-sim's src/client/simulator/orientation.ts, Copyright Evan Bacon, Apache-2.0
// (THIRD_PARTY_NOTICES.md).

// ── Devices ──────────────────────────────────────────────────────────────────

export type SimDeviceState = 'booted' | 'booting' | 'shutdown' | 'other'

export interface SimDevice {
  udid: string
  name: string
  state: SimDeviceState
  /** Display name of its runtime, e.g. "iOS 26.3". */
  runtime: string
}

export interface SimRuntimeGroup {
  /** "iOS 26.3" */
  runtime: string
  devices: SimDevice[]
}

/** What 选择设备 lists: no Xcode (xcrun simctl failed), or the available iOS simulators grouped by runtime. */
export type SimulatorListing = { kind: 'no-xcode' } | { kind: 'devices'; runtimes: SimRuntimeGroup[]; lastUdid: string | null }

const UDID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i

export function isUdid(value: unknown): value is string {
  return typeof value === 'string' && UDID.test(value)
}

const IOS_RUNTIME = /SimRuntime\.iOS-(\d+)-(\d+)(?:-(\d+))?$/

/** `com.apple.CoreSimulator.SimRuntime.iOS-26-3` → "iOS 26.3"; null for any other platform (watchOS, tvOS, visionOS). */
export function iosRuntimeName(key: string): string | null {
  const m = IOS_RUNTIME.exec(key)
  if (!m) return null
  return `iOS ${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

function runtimeVersion(key: string): number[] {
  const m = IOS_RUNTIME.exec(key)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : []
}

function compareVersionsDesc(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function deviceState(raw: unknown): SimDeviceState {
  switch (raw) {
    case 'Booted':
      return 'booted'
    case 'Booting':
      return 'booting'
    case 'Shutdown':
      return 'shutdown'
    default:
      return 'other'
  }
}

/**
 * `xcrun simctl list devices available -j` → its iOS simulators grouped by runtime, newest runtime first, devices in
 * simctl's order. Malformed entries are skipped; anything that is not that JSON gives no groups.
 */
export function parseSimctlDevices(json: unknown): SimRuntimeGroup[] {
  if (typeof json !== 'object' || json === null) return []
  const devices = (json as { devices?: unknown }).devices
  if (typeof devices !== 'object' || devices === null || Array.isArray(devices)) return []
  const groups: { key: string; group: SimRuntimeGroup }[] = []
  for (const [key, list] of Object.entries(devices as Record<string, unknown>)) {
    const runtime = iosRuntimeName(key)
    if (!runtime || !Array.isArray(list)) continue
    const group: SimRuntimeGroup = { runtime, devices: [] }
    for (const raw of list as unknown[]) {
      if (typeof raw !== 'object' || raw === null) continue
      const { udid, name, state, isAvailable } = raw as Record<string, unknown>
      if (!isUdid(udid) || typeof name !== 'string' || name === '' || isAvailable === false) continue
      group.devices.push({ udid, name, state: deviceState(state), runtime })
    }
    if (group.devices.length > 0) groups.push({ key, group })
  }
  groups.sort((a, b) => compareVersionsDesc(runtimeVersion(a.key), runtimeVersion(b.key)))
  return groups.map((g) => g.group)
}

export function findDevice(runtimes: SimRuntimeGroup[], udid: string | null): SimDevice | null {
  if (!udid) return null
  for (const group of runtimes) for (const device of group.devices) if (device.udid === udid) return device
  return null
}

/**
 * The device the view opens on: the remembered one while it is booted (or still booting), else the first booted one,
 * else none (选择设备).
 */
export function initialDevice(runtimes: SimRuntimeGroup[], lastUdid: string | null): SimDevice | null {
  const last = findDevice(runtimes, lastUdid)
  if (last?.state === 'booted' || last?.state === 'booting') return last
  for (const group of runtimes) for (const device of group.devices) if (device.state === 'booted') return device
  return null
}

// ── Screen state (main → renderer) ───────────────────────────────────────────

export type SimOrientation = 'portrait' | 'portrait_upside_down' | 'landscape_left' | 'landscape_right'

export const SIM_ORIENTATIONS: readonly SimOrientation[] = ['portrait', 'portrait_upside_down', 'landscape_left', 'landscape_right']

export function isSimOrientation(value: unknown): value is SimOrientation {
  return typeof value === 'string' && (SIM_ORIENTATIONS as readonly string[]).includes(value)
}

/** booting: `simctl bootstatus -b` · connecting: helper starting, no frame yet · live: frames · failed: see `error`. */
export type SimulatorPhase = 'booting' | 'connecting' | 'live' | 'failed'

export interface SimulatorScreen {
  udid: string
  phase: SimulatorPhase
  /** Size of the frames in pixels as the helper reports them (0 before the first frame). */
  width: number
  height: number
  orientation: SimOrientation
  /** Xcode 27's Device Hub has the device's input: taps and keys do not reach it until 修复输入. */
  inputBlocked: boolean
  error: string | null
}

/** One message on the frame port (main → page). The page answers each with SIM_FRAME_ACK once it is decoded. */
export interface SimFrameMessage {
  jpeg: Uint8Array
}

export const SIM_FRAME_ACK = 'ack'

/** window.postMessage data the preload uses to hand the page the frame port main sent (Electron's documented route). */
export const SIM_PORT_MESSAGE = 'wavi:simulator-frames'

// ── Input (renderer → main → helper) ─────────────────────────────────────────

export type SimTouchPhase = 'begin' | 'move' | 'end'
export type SimKeyPhase = 'down' | 'up'

/** Normalised to the device's raw screen, 0..1. `edge` 0 or one of the HID_EDGE values (system edge gesture). */
export interface SimTouch {
  phase: SimTouchPhase
  x: number
  y: number
  edge: number
}

/** A wheel / trackpad pan: deltas in fractions of the raw screen (positive dy = content scrolls down), anchor 0..1. */
export interface SimScroll {
  dx: number
  dy: number
  x: number
  y: number
}

export const HID_EDGE_NONE = 0
export const HID_EDGE_LEFT = 1
export const HID_EDGE_TOP = 2
export const HID_EDGE_BOTTOM = 3
export const HID_EDGE_RIGHT = 4

/** A drag that starts in the bottom 7% of the shown screen is the home indicator's swipe. */
export const HOME_INDICATOR_BAND = 0.93

/** Rotation button (RotateCw): the device turns clockwise. */
export const ROTATE_RIGHT: Record<SimOrientation, SimOrientation> = {
  portrait: 'landscape_right',
  landscape_right: 'portrait_upside_down',
  portrait_upside_down: 'landscape_left',
  landscape_left: 'portrait'
}

const KEY_USAGE: Record<string, number> = {
  Enter: 0x28,
  NumpadEnter: 0x28,
  Escape: 0x29,
  Backspace: 0x2a,
  Tab: 0x2b,
  Space: 0x2c,
  Minus: 0x2d,
  Equal: 0x2e,
  BracketLeft: 0x2f,
  BracketRight: 0x30,
  Backslash: 0x31,
  Semicolon: 0x33,
  Quote: 0x34,
  Backquote: 0x35,
  Comma: 0x36,
  Period: 0x37,
  Slash: 0x38,
  CapsLock: 0x39,
  Home: 0x4a,
  PageUp: 0x4b,
  Delete: 0x4c,
  End: 0x4d,
  PageDown: 0x4e,
  ArrowRight: 0x4f,
  ArrowLeft: 0x50,
  ArrowDown: 0x51,
  ArrowUp: 0x52,
  IntlBackslash: 0x64,
  ControlLeft: 0xe0,
  ShiftLeft: 0xe1,
  AltLeft: 0xe2,
  MetaLeft: 0xe3,
  ControlRight: 0xe4,
  ShiftRight: 0xe5,
  AltRight: 0xe6,
  MetaRight: 0xe7
}

/** KeyboardEvent.code → USB HID keyboard usage (page 0x07); null for keys the simulator's keyboard has no use for. */
export function hidUsageForCode(code: string): number | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return 0x04 + (letter[1] as string).charCodeAt(0) - 65
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1] === '0' ? 0x27 : 0x1e + Number(digit[1]) - 1
  const fn = /^F([1-9]|1[0-2])$/.exec(code)
  if (fn) return 0x3a + Number(fn[1]) - 1
  return KEY_USAGE[code] ?? null
}

/** Highest usage the key IPC accepts (the keyboard page's modifiers end at 0xe7). */
export const MAX_HID_USAGE = 0xe7

// ── Geometry (renderer) ──────────────────────────────────────────────────────

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The screen's corner radius as a share of its shorter side (iPhone 17 Pro: 0.137). */
export const SIM_CORNER_RATIO = 0.137

function rotationFor(orientation: SimOrientation): number {
  switch (orientation) {
    case 'landscape_left':
      return 90
    case 'landscape_right':
      return -90
    case 'portrait_upside_down':
      return 180
    default:
      return 0
  }
}

const isLandscape = (o: SimOrientation) => o === 'landscape_left' || o === 'landscape_right'

export interface DisplayGeometry {
  /** The screen as the user sees it (landscape when the device is turned). */
  display: Size
  /** Clockwise degrees to turn the raw frame by to show it (0 when the helper already sends it turned). */
  rotation: number
  /** Taps map back to raw coordinates through this orientation; null when the frame is not turned here. */
  inputOrientation: SimOrientation | null
}

/** How a frame of `width × height` is shown for `orientation`; null before the first frame. */
export function displayGeometry(width: number, height: number, orientation: SimOrientation): DisplayGeometry | null {
  if (!(width > 0) || !(height > 0)) return null
  const landscape = isLandscape(orientation) || width > height
  const display = landscape
    ? { width: Math.max(width, height), height: Math.min(width, height) }
    : { width: Math.min(width, height), height: Math.max(width, height) }
  const turn = rotationFor(orientation)
  const rawLandscape = width > height
  const needsRotation = turn === 180 || (Math.abs(turn) === 90 && !rawLandscape)
  return { display, rotation: needsRotation ? turn : 0, inputOrientation: needsRotation ? orientation : null }
}

/** `content` scaled to fit inside `box` and centred in it; empty when either has no area. */
export function fitRect(box: Rect, content: Size): Rect {
  if (!(box.width > 0) || !(box.height > 0) || !(content.width > 0) || !(content.height > 0)) {
    return { x: box.x, y: box.y, width: 0, height: 0 }
  }
  const scale = Math.min(box.width / content.width, box.height / content.height)
  const width = content.width * scale
  const height = content.height * scale
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height }
}

/** A point inside the shown screen as 0..1 of it; null outside (unless `clamp`, for a drag that leaves the screen). */
export function normalizedPoint(point: { x: number; y: number }, screen: Rect, clamp = false): { x: number; y: number } | null {
  if (!(screen.width > 0) || !(screen.height > 0)) return null
  const x = (point.x - screen.x) / screen.width
  const y = (point.y - screen.y) / screen.height
  if (clamp) return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null
}

/** A shown-screen point in the raw frame's coordinates. */
export function rawPoint(orientation: SimOrientation | null, x: number, y: number): { x: number; y: number } {
  switch (orientation) {
    case 'landscape_left':
      return { x: y, y: 1 - x }
    case 'landscape_right':
      return { x: 1 - y, y: x }
    case 'portrait_upside_down':
      return { x: 1 - x, y: 1 - y }
    default:
      return { x, y }
  }
}

/** A shown-screen delta (scroll) in the raw frame's coordinates. */
export function rawDelta(orientation: SimOrientation | null, dx: number, dy: number): { dx: number; dy: number } {
  switch (orientation) {
    case 'landscape_left':
      return { dx: dy, dy: -dx }
    case 'landscape_right':
      return { dx: -dy, dy: dx }
    case 'portrait_upside_down':
      return { dx: -dx, dy: -dy }
    default:
      return { dx, dy }
  }
}

/** The shown screen's bottom edge as the raw device's edge. */
export function rawBottomEdge(orientation: SimOrientation | null): number {
  switch (orientation) {
    case 'landscape_left':
      return HID_EDGE_RIGHT
    case 'landscape_right':
      return HID_EDGE_LEFT
    case 'portrait_upside_down':
      return HID_EDGE_TOP
    default:
      return HID_EDGE_BOTTOM
  }
}

// ── MJPEG (main) ─────────────────────────────────────────────────────────────

/** A part larger than this is not a simulator frame (a 2622-high screen is ~0.4 MB): the parser resyncs. */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024
const MAX_HEADER_BYTES = 1024

const CRLFCRLF = [13, 10, 13, 10]
const BOUNDARY_PREFIX = [45, 45] // "--"

function indexOf(haystack: Uint8Array, needle: readonly number[], from: number): number {
  outer: for (let i = Math.max(0, from); i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

/**
 * Splits a `multipart/x-mixed-replace` body into its JPEG parts, fed chunk by chunk as they arrive. Each part is
 * `--<boundary>\r\n<headers>\r\n\r\n<Content-Length bytes>`; bytes before a boundary are skipped, and a part without a
 * usable Content-Length is dropped (the parser looks for the next boundary).
 */
export class MjpegParser {
  /** Bytes before a part's body: where the next boundary and header are looked for (small). */
  private pending: Uint8Array = new Uint8Array(0)
  /** The current part's body, allocated once from its Content-Length and filled as chunks arrive. */
  private body: Uint8Array | null = null
  private filled = 0

  push(chunk: Uint8Array): Uint8Array[] {
    const frames: Uint8Array[] = []
    let input = chunk
    for (;;) {
      if (this.body) {
        // Each body byte is copied exactly once, however small the chunks (a frame is ~350 KB).
        const take = Math.min(input.length, this.body.length - this.filled)
        this.body.set(input.subarray(0, take), this.filled)
        this.filled += take
        input = input.subarray(take)
        if (this.filled < this.body.length) break
        frames.push(this.body)
        this.body = null
        if (input.length === 0) break
      }
      this.pending = concat(this.pending, input)
      const start = indexOf(this.pending, BOUNDARY_PREFIX, 0)
      if (start < 0) {
        // Keep a trailing "-" that may start the next boundary.
        this.pending = this.pending.subarray(Math.max(0, this.pending.length - 1))
        break
      }
      const end = indexOf(this.pending, CRLFCRLF, start)
      if (end < 0) {
        if (this.pending.length - start > MAX_HEADER_BYTES) this.pending = this.pending.subarray(start + 2)
        else {
          this.pending = this.pending.subarray(start)
          break
        }
        input = this.pending
        this.pending = new Uint8Array(0)
        continue
      }
      const header = new TextDecoder().decode(this.pending.subarray(start, end))
      const length = /\r\ncontent-length:\s*(\d+)/i.exec(header)
      const n = length ? Number(length[1]) : NaN
      input = this.pending.subarray(Number.isSafeInteger(n) && n > 0 && n <= MAX_FRAME_BYTES ? end + 4 : start + 2)
      this.pending = new Uint8Array(0)
      if (Number.isSafeInteger(n) && n > 0 && n <= MAX_FRAME_BYTES) {
        this.body = new Uint8Array(n)
        this.filled = 0
      }
      if (input.length === 0 && !this.body) break
    }
    return frames
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b
  if (b.length === 0) return a
  const next = new Uint8Array(a.length + b.length)
  next.set(a, 0)
  next.set(b, a.length)
  return next
}

// ── IPC ──────────────────────────────────────────────────────────────────────

export interface SimulatorApi {
  /** Available iOS simulators and the last one this view showed; `no-xcode` when `xcrun simctl` cannot run. */
  list(): Promise<SimulatorListing>
  /**
   * Shows `udid` in this window: boots it when it is not booted, starts its helper and sends frames to the page over
   * a fresh MessagePort (window `message` event with data SIM_PORT_MESSAGE). Remembered as the last device.
   */
  show(udid: string): void
  /** The view closed or the window was hidden: stop sending frames (the helper stops 60 s later). */
  hide(): void
  touch(touch: SimTouch): void
  scroll(scroll: SimScroll): void
  key(phase: SimKeyPhase, usage: number): void
  home(): void
  /** Turns the device clockwise. */
  rotate(): void
  /** 修复输入: serve-sim repair-input (restarts SpringBoard, closing running apps). Resolves false when it failed. */
  repairInput(): Promise<boolean>
  /** 在 App Store 中打开: Xcode's App Store page. */
  openXcodeInAppStore(): void
  /** The shown device's state (null once nothing is shown in this window). */
  onScreen(listener: (screen: SimulatorScreen | null) => void): () => void
}

export const SIMULATOR_IPC = {
  /** invoke → SimulatorListing */
  list: 'simulator:list',
  show: 'simulator:show',
  hide: 'simulator:hide',
  touch: 'simulator:touch',
  scroll: 'simulator:scroll',
  key: 'simulator:key',
  home: 'simulator:home',
  rotate: 'simulator:rotate',
  /** invoke → boolean */
  repairInput: 'simulator:repair-input',
  openXcodeInAppStore: 'simulator:open-xcode',
  /** main → renderer: SimulatorScreen | null */
  screen: 'simulator:screen',
  /** main → renderer, with the frame MessagePort */
  port: 'simulator:port'
} as const
