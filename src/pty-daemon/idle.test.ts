import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IdleTimer } from './idle'

describe('IdleTimer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires once the daemon has stayed idle for the grace period', () => {
    const onIdle = vi.fn()
    const timer = new IdleTimer(1000, () => true, onIdle)
    timer.update()
    vi.advanceTimersByTime(999)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('is cancelled when the daemon gets busy again (an app connects, a session starts)', () => {
    let idle = true
    const onIdle = vi.fn()
    const timer = new IdleTimer(1000, () => idle, onIdle)
    timer.update()
    vi.advanceTimersByTime(500)
    idle = false
    timer.update()
    vi.advanceTimersByTime(5000)
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('re-checks at the deadline and does not restart a running countdown', () => {
    let idle = true
    const onIdle = vi.fn()
    const timer = new IdleTimer(1000, () => idle, onIdle)
    timer.update()
    vi.advanceTimersByTime(600)
    timer.update()
    idle = false
    vi.advanceTimersByTime(400)
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('never fires after stop()', () => {
    const onIdle = vi.fn()
    const timer = new IdleTimer(1000, () => true, onIdle)
    timer.update()
    timer.stop()
    timer.update()
    vi.advanceTimersByTime(5000)
    expect(onIdle).not.toHaveBeenCalled()
  })
})
