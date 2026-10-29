import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AppearanceSettings } from '@shared/settings'
import {
  backdropCss,
  needsTransparency,
  ringCss,
  terminalBackgroundAlpha,
  toAppearanceDom,
  toTerminalAppearance
} from './map'

const base: AppearanceSettings = DEFAULT_SETTINGS.appearance

describe('toTerminalAppearance', () => {
  it('maps font settings one to one', () => {
    expect(toTerminalAppearance({ ...base, latinFont: 'Fira Code', cjkFont: 'Hiragino Sans GB', fontSize: 16, lineHeight: 1.4, ligatures: true })).toEqual({
      fontFamily: 'Fira Code',
      cjkFontFamily: 'Hiragino Sans GB',
      fontSize: 16,
      lineHeight: 1.4,
      ligatures: true,
      backgroundAlpha: 1,
      screenReader: false
    })
    expect(toTerminalAppearance({ ...base, screenReader: true }).screenReader).toBe(true)
  })
})

describe('terminal transparency', () => {
  it('is off for a solid, fully opaque terminal', () => {
    expect(terminalBackgroundAlpha(base)).toBe(1)
    expect(needsTransparency(base)).toBe(false)
  })
  it('turns on for opacity < 1', () => {
    const a = { ...base, terminalOpacity: 0.8 }
    expect(terminalBackgroundAlpha(a)).toBe(0.8)
    expect(needsTransparency(a)).toBe(true)
  })
})

describe('backdropCss', () => {
  it('is the theme terminal color, or nothing when translucent', () => {
    expect(backdropCss(base)).toBe('var(--term-bg)')
    expect(backdropCss({ ...base, terminalOpacity: 0.7 })).toBe('transparent')
  })
})

describe('ringCss', () => {
  it('repeats the cell color at the terminal opacity around the canvas, nothing when opaque', () => {
    expect(ringCss(base)).toBe('transparent')
    expect(ringCss({ ...base, terminalOpacity: 0.72 })).toBe('color-mix(in srgb, var(--term-bg) 72%, transparent)')
  })
})

describe('toAppearanceDom', () => {
  it('lets the surface layers go transparent only when the terminal is', () => {
    expect(toAppearanceDom(base).vars['--tr-term-surface']).toBe('var(--term-bg)')
    expect(toAppearanceDom({ ...base, terminalOpacity: 0.8 }).vars['--tr-term-surface']).toBe('transparent')
  })

  it('names the full-screen palette on <html> (auto picks by theme in CSS)', () => {
    expect(toAppearanceDom(base).attrs).toEqual({ 'data-fs-backdrop': 'auto' })
    expect(toAppearanceDom({ ...base, fullscreenBackdrop: 'dune' }).attrs['data-fs-backdrop']).toBe('dune')
  })
})
