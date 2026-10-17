import { describe, expect, it } from 'vitest'
import { ECHO_MS, isKeyEcho, noteKeyCommand } from './key-commands'

describe('isKeyEcho', () => {
  it('drops a menu command right after the same shortcut ran, not later and not others', () => {
    noteKeyCommand('find', 1_000)
    expect(isKeyEcho('find', 1_000 + ECHO_MS - 1)).toBe(true)
    expect(isKeyEcho('find', 1_000 + ECHO_MS)).toBe(false)
    expect(isKeyEcho('toggle-sidebar', 1_000)).toBe(false)
  })
})
