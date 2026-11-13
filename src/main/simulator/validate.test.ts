import { describe, expect, it } from 'vitest'
import { parseKeyPhase, parseScroll, parseTouch, parseUdid, parseUsage } from './validate'
import { encodeHid, parseConfigMessage } from './stream'
import { parseHelperLine } from './helper'
import { sanitizeLastUdid } from './remembered'

const UDID = 'D08CB4F0-C5A9-47B3-B65E-B395108FF267'

describe('simulator IPC payloads', () => {
  it('accepts a udid and nothing else', () => {
    expect(parseUdid(UDID)).toBe(UDID)
    for (const bad of ['booted', '', `${UDID}\n`, null, 1]) expect(() => parseUdid(bad)).toThrow()
  })

  it('accepts touches in 0..1 with a known phase and edge', () => {
    expect(parseTouch({ phase: 'begin', x: 0, y: 1, edge: 3 })).toEqual({ phase: 'begin', x: 0, y: 1, edge: 3 })
    for (const bad of [
      { phase: 'tap', x: 0.5, y: 0.5, edge: 0 },
      { phase: 'move', x: 1.01, y: 0.5, edge: 0 },
      { phase: 'move', x: Number.NaN, y: 0.5, edge: 0 },
      { phase: 'move', x: '0.5', y: 0.5, edge: 0 },
      { phase: 'end', x: 0.5, y: 0.5, edge: 9 },
      { phase: 'end', x: 0.5, y: 0.5 },
      [0.5, 0.5],
      null
    ])
      expect(() => parseTouch(bad)).toThrow()
  })

  it('accepts bounded scroll deltas with an anchor on the screen', () => {
    expect(parseScroll({ dx: 0, dy: -0.25, x: 0.5, y: 0.5 })).toEqual({ dx: 0, dy: -0.25, x: 0.5, y: 0.5 })
    expect(() => parseScroll({ dx: 0, dy: 40, x: 0.5, y: 0.5 })).toThrow()
    expect(() => parseScroll({ dx: Infinity, dy: 0, x: 0.5, y: 0.5 })).toThrow()
    expect(() => parseScroll({ dx: 0, dy: 0, x: 2, y: 0.5 })).toThrow()
  })

  it('accepts key phases and keyboard-page usages', () => {
    expect(parseKeyPhase('down')).toBe('down')
    expect(() => parseKeyPhase('press')).toThrow()
    expect(parseUsage(0x04)).toBe(0x04)
    expect(parseUsage(0xe7)).toBe(0xe7)
    for (const bad of [0, 0xe8, 1.5, '4']) expect(() => parseUsage(bad)).toThrow()
  })
})

describe('helper protocol', () => {
  it('reads the helper line only when it points at loopback for this device', () => {
    const line = JSON.stringify({
      url: 'http://127.0.0.1:3917',
      streamUrl: `http://127.0.0.1:3917/helper/${UDID}/stream.mjpeg`,
      wsUrl: `ws://127.0.0.1:3917/helper/${UDID}/ws`,
      port: 3917,
      device: UDID
    })
    expect(parseHelperLine(line, UDID)).toEqual({
      streamUrl: `http://127.0.0.1:3917/helper/${UDID}/stream.mjpeg`,
      wsUrl: `ws://127.0.0.1:3917/helper/${UDID}/ws`,
      port: 3917
    })
    expect(parseHelperLine(line.replaceAll('127.0.0.1', '10.0.0.2'), UDID)).toBeNull()
    expect(parseHelperLine(line, 'B9FA2F0C-A518-4490-8C4A-7EDE21937603')).toBeNull()
    expect(parseHelperLine('serve-sim starting…', UDID)).toBeNull()
  })

  it('frames input as [tag][JSON] and reads config messages', () => {
    const frame = encodeHid(0x03, { type: 'begin', x: 0.5, y: 0.25 })
    expect(frame[0]).toBe(0x03)
    expect(JSON.parse(new TextDecoder().decode(frame.subarray(1)))).toEqual({ type: 'begin', x: 0.5, y: 0.25 })
    const config = new Uint8Array([0x82, ...new TextEncoder().encode('{"width":1206,"height":2622,"orientation":"landscape_left"}')])
    expect(parseConfigMessage(config)).toEqual({ width: 1206, height: 2622, orientation: 'landscape_left' })
    expect(parseConfigMessage(new Uint8Array([0x03, 0x7b, 0x7d]))).toBeNull()
  })
})

describe('remembered device', () => {
  it('keeps a well-formed udid only', () => {
    expect(sanitizeLastUdid({ lastUdid: UDID })).toBe(UDID)
    expect(sanitizeLastUdid({ lastUdid: '../x' })).toBeNull()
    expect(sanitizeLastUdid(null)).toBeNull()
  })
})
