import { describe, expect, it } from 'vitest'
import { SYSTEM_SHUTDOWN_WINDOW_MS, SystemShutdown } from './sigterm'

describe('SystemShutdown', () => {
  it('is not in progress until main reports one (a stray SIGTERM keeps the sessions)', () => {
    expect(new SystemShutdown().inProgress(1_000)).toBe(false)
  })

  it('is in progress from the report until the window ends', () => {
    const shutdown = new SystemShutdown()
    shutdown.report(10_000)
    expect(shutdown.inProgress(10_000)).toBe(true)
    expect(shutdown.inProgress(10_000 + SYSTEM_SHUTDOWN_WINDOW_MS)).toBe(true)
    expect(shutdown.inProgress(10_001 + SYSTEM_SHUTDOWN_WINDOW_MS)).toBe(false)
  })

  it('a cancelled logout reported long ago does not make a later SIGTERM end the sessions', () => {
    const shutdown = new SystemShutdown()
    shutdown.report(0)
    expect(shutdown.inProgress(60 * 60_000)).toBe(false)
  })

  it('a newer report restarts the window', () => {
    const shutdown = new SystemShutdown()
    shutdown.report(0)
    shutdown.report(SYSTEM_SHUTDOWN_WINDOW_MS)
    expect(shutdown.inProgress(SYSTEM_SHUTDOWN_WINDOW_MS * 2)).toBe(true)
  })

  it('ignores a report from the future', () => {
    const shutdown = new SystemShutdown()
    shutdown.report(5_000)
    expect(shutdown.inProgress(4_000)).toBe(false)
  })
})
