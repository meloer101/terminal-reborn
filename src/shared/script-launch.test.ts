import { describe, expect, it } from 'vitest'
import { appendScriptOutput, MAX_SCRIPT_OUTPUT, parseScriptMarker } from './script-launch'

describe('parseScriptMarker', () => {
  it('knows the setup markers only', () => {
    expect(parseScriptMarker('setup;0')).toEqual({ type: 'setup-exit', code: 0 })
    expect(parseScriptMarker('setup;127')).toEqual({ type: 'setup-exit', code: 127 })
    expect(parseScriptMarker('setup-done')).toEqual({ type: 'setup-done' })
    expect(parseScriptMarker('setup;-1')).toBeNull()
    expect(parseScriptMarker('exit;0')).toBeNull()
  })
})

describe('appendScriptOutput', () => {
  it('keeps the tail and drops a line the cut split', () => {
    expect(appendScriptOutput('hello', '\n')).toBe('hello\n')
    const head = `partial-line\n${'x'.repeat(MAX_SCRIPT_OUTPUT)}`
    expect(appendScriptOutput('', head)).toBe('x'.repeat(MAX_SCRIPT_OUTPUT))
    const lined = `${'a'.repeat(MAX_SCRIPT_OUTPUT)}\nkept\n`
    expect(appendScriptOutput('', lined)).toBe('kept\n')
  })
})
