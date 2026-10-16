import { describe, expect, it } from 'vitest'
import { restorePayload } from './snapshot-payload'

describe('restorePayload', () => {
  it('replays a plain screen and starts a fresh line', () => {
    expect(restorePayload('$ ls\r\na b', 24)).toBe('$ ls\r\na b\x1b[0m\r\n')
  })

  it('draws an alternate-screen frame in the normal buffer without switching screens', () => {
    const out = restorePayload('$ claude\x1b[?1049h\x1b[HFRAME', 3)
    expect(out).not.toContain('\x1b[?1049h')
    expect(out).toBe('$ claude\x1b[0m\r\n\r\n\r\n\x1b[HFRAME\x1b[0m\x1b[3;1H')
  })
})
