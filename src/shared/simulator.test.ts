import { describe, expect, it } from 'vitest'
import {
  displayGeometry,
  fitRect,
  hidUsageForCode,
  initialDevice,
  iosRuntimeName,
  isUdid,
  MjpegParser,
  normalizedPoint,
  parseSimctlDevices,
  rawBottomEdge,
  rawDelta,
  rawPoint,
  ROTATE_RIGHT,
  HID_EDGE_BOTTOM,
  HID_EDGE_LEFT,
  MAX_FRAME_BYTES,
  HID_EDGE_TOP,
  HID_EDGE_RIGHT
} from './simulator'

const A = 'D08CB4F0-C5A9-47B3-B65E-B395108FF267'
const B = 'B9FA2F0C-A518-4490-8C4A-7EDE21937603'
const C = 'C9C93701-8007-4888-97D2-38E266F3F180'

const simctl = {
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-18-6': [{ udid: C, name: 'iPhone 16', state: 'Shutdown', isAvailable: true }],
    'com.apple.CoreSimulator.SimRuntime.iOS-26-3': [
      { udid: A, name: 'iPhone 17 Pro', state: 'Booted', isAvailable: true },
      { udid: B, name: 'iPhone 17', state: 'Shutdown', isAvailable: true },
      { udid: 'not-a-udid', name: 'Broken', state: 'Shutdown' }
    ],
    'com.apple.CoreSimulator.SimRuntime.watchOS-26-2': [
      { udid: '11111111-2222-3333-4444-555555555555', name: 'Apple Watch', state: 'Shutdown', isAvailable: true }
    ]
  }
}

describe('simctl devices', () => {
  it('names iOS runtimes and skips the other platforms', () => {
    expect(iosRuntimeName('com.apple.CoreSimulator.SimRuntime.iOS-26-3')).toBe('iOS 26.3')
    expect(iosRuntimeName('com.apple.CoreSimulator.SimRuntime.iOS-17-0-1')).toBe('iOS 17.0.1')
    expect(iosRuntimeName('com.apple.CoreSimulator.SimRuntime.xrOS-26-2')).toBeNull()
  })

  it('groups iOS devices by runtime, newest first, dropping malformed entries', () => {
    const groups = parseSimctlDevices(simctl)
    expect(groups.map((g) => g.runtime)).toEqual(['iOS 26.3', 'iOS 18.6'])
    expect(groups[0]?.devices).toEqual([
      { udid: A, name: 'iPhone 17 Pro', state: 'booted', runtime: 'iOS 26.3' },
      { udid: B, name: 'iPhone 17', state: 'shutdown', runtime: 'iOS 26.3' }
    ])
  })

  it('gives nothing for output that is not simctl JSON', () => {
    expect(parseSimctlDevices(null)).toEqual([])
    expect(parseSimctlDevices({ devices: [] })).toEqual([])
    expect(parseSimctlDevices('x')).toEqual([])
  })

  it('opens on the remembered device while booted, else the first booted, else none', () => {
    const groups = parseSimctlDevices(simctl)
    expect(initialDevice(groups, B)?.udid).toBe(A)
    expect(initialDevice(groups, A)?.udid).toBe(A)
    const none = parseSimctlDevices({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-3': [{ udid: B, name: 'iPhone 17', state: 'Shutdown' }] } })
    expect(initialDevice(none, B)).toBeNull()
  })

  it('accepts only udid-shaped strings', () => {
    expect(isUdid(A)).toBe(true)
    expect(isUdid(A.toLowerCase())).toBe(true)
    expect(isUdid('booted')).toBe(false)
    expect(isUdid(`${A} ; rm`)).toBe(false)
    expect(isUdid(42)).toBe(false)
  })
})

const enc = new TextEncoder()
function part(body: Uint8Array): Uint8Array {
  const head = enc.encode(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${body.length}\r\n\r\n`)
  const out = new Uint8Array(head.length + body.length + 2)
  out.set(head, 0)
  out.set(body, head.length)
  out.set([13, 10], head.length + body.length)
  return out
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('MjpegParser', () => {
  const jpegA = new Uint8Array([0xff, 0xd8, 45, 45, 13, 10, 13, 10, 0xff, 0xd9])
  const jpegB = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9])

  it('splits parts that arrive together', () => {
    const frames = new MjpegParser().push(concat(part(jpegA), part(jpegB)))
    expect(frames).toEqual([jpegA, jpegB])
  })

  it('reassembles parts split across chunks at any byte', () => {
    const stream = concat(part(jpegA), part(jpegB), part(jpegA))
    for (let size = 1; size <= 9; size++) {
      const parser = new MjpegParser()
      const frames: Uint8Array[] = []
      for (let i = 0; i < stream.length; i += size) frames.push(...parser.push(stream.subarray(i, i + size)))
      expect(frames).toEqual([jpegA, jpegB, jpegA])
    }
  })

  it('resyncs after a header that never ends and a part that claims too much', () => {
    const endless = enc.encode('--frame\r\nContent-Type: image/jpeg\r\n' + 'x'.repeat(2000))
    const huge = enc.encode(`--frame\r\nContent-Length: ${MAX_FRAME_BYTES + 1}\r\n\r\n`)
    const parser = new MjpegParser()
    const frames = [...parser.push(endless), ...parser.push(huge), ...parser.push(part(jpegA)), ...parser.push(part(jpegB))]
    expect(frames).toEqual([jpegA, jpegB])
  })

  it('assembles a native-size frame from small chunks byte for byte', () => {
    const big = new Uint8Array(360_000).map((_, i) => (i * 31) & 0xff)
    const stream = concat(part(big), part(jpegB))
    const parser = new MjpegParser()
    const frames: Uint8Array[] = []
    for (let i = 0; i < stream.length; i += 16_384) frames.push(...parser.push(stream.subarray(i, i + 16_384)))
    expect(frames).toEqual([big, jpegB])
  })

  it('skips a preamble and a part without a Content-Length', () => {
    const bad = enc.encode('--frame\r\nContent-Type: image/jpeg\r\n\r\nxx\r\n')
    const frames = new MjpegParser().push(concat(enc.encode('HTTP junk\r\n'), bad, part(jpegB)))
    expect(frames).toEqual([jpegB])
  })
})

describe('keys', () => {
  it('maps KeyboardEvent.code to HID keyboard usages', () => {
    expect(hidUsageForCode('KeyA')).toBe(0x04)
    expect(hidUsageForCode('KeyZ')).toBe(0x1d)
    expect(hidUsageForCode('Digit1')).toBe(0x1e)
    expect(hidUsageForCode('Digit0')).toBe(0x27)
    expect(hidUsageForCode('Enter')).toBe(0x28)
    expect(hidUsageForCode('Backspace')).toBe(0x2a)
    expect(hidUsageForCode('Space')).toBe(0x2c)
    expect(hidUsageForCode('ArrowUp')).toBe(0x52)
    expect(hidUsageForCode('F12')).toBe(0x45)
    expect(hidUsageForCode('ShiftLeft')).toBe(0xe1)
    expect(hidUsageForCode('MetaRight')).toBe(0xe7)
    expect(hidUsageForCode('F13')).toBeNull()
    expect(hidUsageForCode('MediaPlayPause')).toBeNull()
  })
})

describe('geometry', () => {
  it('fits and centres the screen, letterboxing the spare axis', () => {
    expect(fitRect({ x: 0, y: 0, width: 400, height: 1000 }, { width: 1206, height: 2622 })).toEqual({
      x: 0,
      y: (1000 - 2622 * (400 / 1206)) / 2,
      width: 400,
      height: 2622 * (400 / 1206)
    })
    const tall = fitRect({ x: 10, y: 20, width: 1000, height: 500 }, { width: 100, height: 200 })
    expect(tall).toEqual({ x: 10 + 375, y: 20, width: 250, height: 500 })
    expect(fitRect({ x: 0, y: 0, width: 0, height: 10 }, { width: 1, height: 1 }).width).toBe(0)
  })

  it('normalises pointer positions to the shown screen', () => {
    const screen = { x: 100, y: 50, width: 200, height: 400 }
    expect(normalizedPoint({ x: 200, y: 250 }, screen)).toEqual({ x: 0.5, y: 0.5 })
    expect(normalizedPoint({ x: 99, y: 250 }, screen)).toBeNull()
    expect(normalizedPoint({ x: 99, y: 500 }, screen, true)).toEqual({ x: 0, y: 1 })
  })

  it('turns raw portrait frames for a landscape device and maps input back', () => {
    const g = displayGeometry(1206, 2622, 'landscape_left')
    expect(g).toEqual({ display: { width: 2622, height: 1206 }, rotation: 90, inputOrientation: 'landscape_left' })
    // Already-turned frames are drawn as they come.
    expect(displayGeometry(2622, 1206, 'landscape_right')).toEqual({
      display: { width: 2622, height: 1206 },
      rotation: 0,
      inputOrientation: null
    })
    expect(displayGeometry(0, 0, 'portrait')).toBeNull()
    expect(rawPoint('landscape_left', 0.25, 0.75)).toEqual({ x: 0.75, y: 0.75 })
    expect(rawPoint('landscape_right', 0.25, 0.75)).toEqual({ x: 0.25, y: 0.25 })
    expect(rawPoint(null, 0.25, 0.75)).toEqual({ x: 0.25, y: 0.75 })
    expect(rawDelta('portrait_upside_down', 0.1, 0.2)).toEqual({ dx: -0.1, dy: -0.2 })
    expect(rawBottomEdge(null)).toBe(HID_EDGE_BOTTOM)
    expect(rawBottomEdge('landscape_right')).toBe(HID_EDGE_LEFT)
  })

  it('moves a scroll the same way as the points it starts and ends on, in every orientation', () => {
    const orientations = ['portrait', 'portrait_upside_down', 'landscape_left', 'landscape_right', null] as const
    for (const o of orientations) {
      const from = rawPoint(o, 0.4, 0.3)
      const to = rawPoint(o, 0.4 + 0.1, 0.3 + 0.2)
      const delta = rawDelta(o, 0.1, 0.2)
      expect(delta.dx).toBeCloseTo(to.x - from.x)
      expect(delta.dy).toBeCloseTo(to.y - from.y)
    }
    expect(rawPoint('portrait_upside_down', 0.25, 0.75)).toEqual({ x: 0.75, y: 0.25 })
    expect(rawBottomEdge('portrait_upside_down')).toBe(HID_EDGE_TOP)
    expect(rawBottomEdge('landscape_left')).toBe(HID_EDGE_RIGHT)
    expect(displayGeometry(1206, 2622, 'portrait_upside_down')).toEqual({
      display: { width: 1206, height: 2622 },
      rotation: 180,
      inputOrientation: 'portrait_upside_down'
    })
  })

  it('rotates clockwise through all four orientations', () => {
    let o = ROTATE_RIGHT.portrait
    const seen = [o]
    for (let i = 0; i < 3; i++) seen.push((o = ROTATE_RIGHT[o]))
    expect(seen).toEqual(['landscape_right', 'portrait_upside_down', 'landscape_left', 'portrait'])
  })
})
