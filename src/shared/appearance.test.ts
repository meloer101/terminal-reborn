import { describe, expect, it } from 'vitest'
import { resolveTheme, windowBackgroundColor } from './appearance'

describe('resolveTheme', () => {
  it('follows the system only for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('windowBackgroundColor', () => {
  it('matches --bg-app, and is transparent under vibrancy', () => {
    expect(windowBackgroundColor('dark', false)).toBe('#0a0a0a')
    expect(windowBackgroundColor('light', false)).toBe('#ffffff')
    expect(windowBackgroundColor('light', true)).toBe('#00000000')
  })
})
