import { describe, expect, it } from 'vitest'
import { parseScriptMarker } from './script-launch'

describe('parseScriptMarker', () => {
  it('knows the setup markers only', () => {
    expect(parseScriptMarker('setup;0')).toEqual({ type: 'setup-exit', code: 0 })
    expect(parseScriptMarker('setup;127')).toEqual({ type: 'setup-exit', code: 127 })
    expect(parseScriptMarker('setup-done')).toEqual({ type: 'setup-done' })
    expect(parseScriptMarker('setup;-1')).toBeNull()
    expect(parseScriptMarker('exit;0')).toBeNull()
  })
})
