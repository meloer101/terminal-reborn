import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { displayFamily, fontSizeOptions, formatPercent, previewCaption } from './appearance-form'

describe('previewCaption', () => {
  it('matches the Figma caption', () => {
    expect(previewCaption(DEFAULT_SETTINGS.appearance)).toBe('JetBrains Mono 13 · PingFang SC · 行高 1.00')
    expect(previewCaption({ ...DEFAULT_SETTINGS.appearance, lineHeight: 1.4 })).toBe('JetBrains Mono 13 · PingFang SC · 行高 1.40')
  })
})

describe('displayFamily', () => {
  it('hides the Variable suffix only', () => {
    expect(displayFamily('JetBrains Mono Variable')).toBe('JetBrains Mono')
    expect(displayFamily('Variable Sans Pro')).toBe('Variable Sans Pro')
  })
})

describe('fontSizeOptions', () => {
  it('contains the current size exactly once, ascending', () => {
    expect(fontSizeOptions(13).filter((n) => n === 13)).toHaveLength(1)
    expect(fontSizeOptions(17)).toContain(17)
    expect(fontSizeOptions(17)).toEqual([...fontSizeOptions(17)].sort((a, b) => a - b))
  })
})

describe('misc formatting', () => {
  it('formats', () => {
    expect(formatPercent(0.96)).toBe('96%')
  })
})
