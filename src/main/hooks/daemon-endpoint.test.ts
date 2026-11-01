import { describe, expect, it } from 'vitest'
import { relayOutlastsHold } from './daemon-endpoint'

describe('relayOutlastsHold', () => {
  const target = { socketPath: '/d/hook.sock', token: 't', settingsDir: '/d' }

  it('holds on our own hook server, whose only limit is the hook script', () => {
    expect(relayOutlastsHold(null, 120_000)).toBe(true)
  })

  it('holds behind a daemon that waits on the relay longer than the hold', () => {
    expect(relayOutlastsHold({ ...target, permissionRelayMs: 125_000 }, 120_000)).toBe(true)
  })

  it('never holds behind an older daemon (it answers after 10 s and says nothing)', () => {
    expect(relayOutlastsHold(target, 120_000)).toBe(false)
    expect(relayOutlastsHold({ ...target, permissionRelayMs: 120_000 }, 120_000)).toBe(false)
  })
})
