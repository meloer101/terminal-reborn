// Payload checks for the simulator IPC (PRD F17 · iOS 模拟器). Each parser throws on anything malformed; the
// handler drops (and logs) that message instead of acting on it.
import {
  HID_EDGE_NONE,
  HID_EDGE_RIGHT,
  isUdid,
  MAX_HID_USAGE,
  type SimKeyPhase,
  type SimScroll,
  type SimTouch,
  type SimTouchPhase
} from '@shared/simulator'

/** One wheel event moves at most this many screens (a hard fling on a trackpad stays well under it). */
const MAX_SCROLL = 4

export function parseUdid(value: unknown): string {
  if (!isUdid(value)) throw new Error('not a simulator udid')
  return value
}

function unit(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} is not in 0..1`)
  return value
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${name} is not an object`)
  return value as Record<string, unknown>
}

const TOUCH_PHASES: readonly SimTouchPhase[] = ['begin', 'move', 'end']

export function parseTouch(value: unknown): SimTouch {
  const { phase, x, y, edge } = object(value, 'touch')
  if (!TOUCH_PHASES.includes(phase as SimTouchPhase)) throw new Error('bad touch phase')
  if (!Number.isInteger(edge) || (edge as number) < HID_EDGE_NONE || (edge as number) > HID_EDGE_RIGHT) throw new Error('bad edge')
  return { phase: phase as SimTouchPhase, x: unit(x, 'x'), y: unit(y, 'y'), edge: edge as number }
}

export function parseScroll(value: unknown): SimScroll {
  const { dx, dy, x, y } = object(value, 'scroll')
  const delta = (v: unknown, name: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > MAX_SCROLL) throw new Error(`${name} is out of range`)
    return v
  }
  return { dx: delta(dx, 'dx'), dy: delta(dy, 'dy'), x: unit(x, 'x'), y: unit(y, 'y') }
}

export function parseKeyPhase(value: unknown): SimKeyPhase {
  if (value !== 'down' && value !== 'up') throw new Error('bad key phase')
  return value
}

export function parseUsage(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_HID_USAGE) throw new Error('bad HID usage')
  return value as number
}
