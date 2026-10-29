import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuietTimer } from './quiet-timer'

const QUIET = 3000

describe('QuietTimer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(): { timer: QuietTimer; fire: ReturnType<typeof vi.fn> } {
    const fire = vi.fn()
    return { timer: new QuietTimer(QUIET, fire, () => Date.now()), fire }
  }

  it('fires once after many chunks, only when the last one is QUIET old', () => {
    const { timer, fire } = setup()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    // A burst: one chunk every 10 ms for 5 s.
    for (let i = 0; i < 500; i++) {
      timer.touch()
      vi.advanceTimersByTime(10)
    }
    expect(fire).not.toHaveBeenCalled()
    // Last chunk at 4990 ms; quiet since then for QUIET - 10 so far.
    vi.advanceTimersByTime(QUIET - 11)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(QUIET * 10)
    expect(fire).toHaveBeenCalledTimes(1)
    // One timer armed by the first touch, one re-arm per elapsed period: not one per chunk.
    expect(setTimeoutSpy.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('fires QUIET after a single touch, and again after the next touch', () => {
    const { timer, fire } = setup()
    timer.touch()
    vi.advanceTimersByTime(QUIET - 1)
    expect(fire).not.toHaveBeenCalled()
    expect(timer.armed).toBe(true)
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledTimes(1)
    expect(timer.armed).toBe(false)
    timer.touch()
    vi.advanceTimersByTime(QUIET)
    expect(fire).toHaveBeenCalledTimes(2)
  })

  it('re-arms for the remainder when touched just before it was due', () => {
    const { timer, fire } = setup()
    timer.touch()
    vi.advanceTimersByTime(QUIET - 500)
    timer.touch()
    vi.advanceTimersByTime(500)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(QUIET - 501)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('never fires once cancelled', () => {
    const { timer, fire } = setup()
    timer.touch()
    timer.cancel()
    vi.advanceTimersByTime(QUIET * 2)
    expect(fire).not.toHaveBeenCalled()
    expect(timer.armed).toBe(false)
  })
})
