import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseWake, WakeTimer } from './wake'

let dir = ''
beforeEach(() => {
  vi.useFakeTimers()
  dir = mkdtempSync(join(tmpdir(), 'wavi-wake-'))
  mkdirSync(join(dir, 'Wavi.app'))
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

function setup(connected = false) {
  const opened: string[] = []
  let changes = 0
  const timer = new WakeTimer({ now: () => Date.now(), appConnected: () => connected, open: (app) => opened.push(app), changed: () => changes++, log: () => {} })
  return { timer, opened, changes: () => changes }
}

describe('WakeTimer', () => {
  it('opens the app at the time when none is connected, then forgets the wake', () => {
    const t = setup()
    const app = join(dir, 'Wavi.app')
    t.timer.set({ at: Date.now() + 3 * 60_000, app })
    expect(t.timer.pending).toBe(true)
    vi.advanceTimersByTime(2 * 60_000)
    expect(t.opened).toEqual([])
    vi.advanceTimersByTime(60_000)
    expect(t.opened).toEqual([app])
    expect(t.timer.pending).toBe(false)
  })

  it('does nothing while the app is connected, and keeps no wake for a missing app', () => {
    const t = setup(true)
    t.timer.set({ at: Date.now() + 1000, app: join(dir, 'Wavi.app') })
    vi.advanceTimersByTime(2000)
    expect(t.opened).toEqual([])
    t.timer.set({ at: Date.now() + 1000, app: join(dir, 'Gone.app') })
    expect(t.timer.pending).toBe(false)
  })

  it('takes only an absolute .app path and a near enough time', () => {
    expect(parseWake({ at: 5, app: '/Applications/Wavi.app' }, 0)).toEqual({ at: 5, app: '/Applications/Wavi.app' })
    expect(parseWake({ at: 5, app: 'Wavi.app' }, 0)).toBeNull()
    expect(parseWake({ at: 5, app: '/bin/sh' }, 0)).toBeNull()
    expect(parseWake({ at: null, app: '/Applications/Wavi.app' }, 0)).toBeNull()
  })
})
