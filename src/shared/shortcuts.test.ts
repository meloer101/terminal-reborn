import { describe, expect, it } from 'vitest'
import { isMenuCommand, stepFontSize } from './shortcuts'

describe('isMenuCommand', () => {
  it('accepts known commands only', () => {
    expect(isMenuCommand('find')).toBe(true)
    expect(isMenuCommand('rm -rf')).toBe(false)
    expect(isMenuCommand(3)).toBe(false)
  })
})

describe('stepFontSize', () => {
  it('steps by one and stays within the limits', () => {
    expect(stepFontSize(13, 'bigger')).toBe(14)
    expect(stepFontSize(13, 'smaller')).toBe(12)
    expect(stepFontSize(28, 'bigger')).toBe(28)
    expect(stepFontSize(9, 'smaller')).toBe(9)
    expect(stepFontSize(20, 'reset')).toBe(13)
  })
})
