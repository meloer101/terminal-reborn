import { describe, expect, it } from 'vitest'
import { createWheelState, isDiscreteWheel, wheelReportCount } from './tui-wheel'

const CELL = { cellHeight: 20, rows: 40 }

describe('wheelReportCount', () => {
  it('maps trackpad pixels 1:1 to rows and carries the remainder', () => {
    const state = createWheelState()
    // Small deltas that xterm alone would damp to almost nothing.
    const counts = [8, 8, 8, 8, 8].map((deltaY) => wheelReportCount({ deltaY, deltaMode: 0 }, state, CELL))
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2) // 40px / 20px rows
    expect(state.pendingRows).toBeCloseTo(0)
  })

  it('does not cap a fast trackpad flick', () => {
    expect(wheelReportCount({ deltaY: 45, deltaMode: 0 }, createWheelState(), { cellHeight: 5 })).toBe(9)
  })

  it('drops carried distance when the direction reverses', () => {
    const state = createWheelState()
    wheelReportCount({ deltaY: 15, deltaMode: 0 }, state, CELL)
    expect(wheelReportCount({ deltaY: -15, deltaMode: 0 }, state, CELL)).toBe(0)
    expect(wheelReportCount({ deltaY: -10, deltaMode: 0 }, state, CELL)).toBe(1)
  })

  it('gives a mouse-wheel notch at least one row, log-compressed', () => {
    const state = createWheelState()
    expect(wheelReportCount({ deltaY: 1, deltaMode: 1 }, state)).toBe(1)
    // A notch reported as 3 lines: 1 + log2(3) * 1.6 ≈ 3.5 → 3, remainder carried.
    expect(wheelReportCount({ deltaY: 3, deltaMode: 1, timeStamp: 1000 }, createWheelState())).toBe(3)
  })

  it('speeds up quick bursts of notches', () => {
    const slow = createWheelState()
    const fast = createWheelState()
    let slowTotal = 0
    let fastTotal = 0
    for (let i = 0; i < 6; i++) {
      slowTotal += wheelReportCount({ deltaY: 100, deltaMode: 0, wheelDeltaY: -120, timeStamp: i * 200 }, slow, CELL)
      fastTotal += wheelReportCount({ deltaY: 100, deltaMode: 0, wheelDeltaY: -120, timeStamp: i * 10 }, fast, CELL)
    }
    expect(fastTotal).toBeGreaterThan(slowTotal)
  })

  it('tells a trackpad from a notched wheel', () => {
    expect(isDiscreteWheel({ deltaY: 4, deltaMode: 0 })).toBe(false)
    expect(isDiscreteWheel({ deltaY: 4, deltaMode: 0, wheelDeltaY: -120 })).toBe(true)
    expect(isDiscreteWheel({ deltaY: 1, deltaMode: 1 })).toBe(true)
  })
})
