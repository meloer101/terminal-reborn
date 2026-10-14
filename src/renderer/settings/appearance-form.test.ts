import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { backgroundForKind, displayFamily, fileName, fontSizeOptions, formatPercent, gradientCss, previewCaption } from './appearance-form'

describe('previewCaption', () => {
  it('matches the Figma caption', () => {
    expect(previewCaption(DEFAULT_SETTINGS.appearance)).toBe('JetBrains Mono 13 · PingFang SC · 行高 1.54')
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

describe('backgroundForKind', () => {
  const solid = { kind: 'solid' } as const
  it('returns the current value when the kind is unchanged', () => {
    expect(backgroundForKind('solid', solid)).toBe(solid)
  })
  it('creates a default gradient, or restores the remembered one', () => {
    expect(backgroundForKind('gradient', solid)).toMatchObject({ kind: 'gradient' })
    const remembered = { kind: 'gradient', from: '#112233', to: '#445566', angle: 10 } as const
    expect(backgroundForKind('gradient', solid, { gradient: remembered })).toBe(remembered)
  })
  it('does not switch to image without a file', () => {
    expect(backgroundForKind('image', solid)).toBeNull()
    const image = { kind: 'image', path: '/a/b.png', dim: 0.5 } as const
    expect(backgroundForKind('image', solid, { image })).toBe(image)
  })
})

describe('misc formatting', () => {
  it('formats', () => {
    expect(formatPercent(0.96)).toBe('96%')
    expect(gradientCss({ kind: 'gradient', from: '#000000', to: '#ffffff', angle: 90.4 })).toBe('linear-gradient(90deg, #000000, #ffffff)')
    expect(fileName('/Users/dev/Pictures/bg.png')).toBe('bg.png')
  })
})
