import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AppearanceSettings } from '@shared/settings'
import { backdropCss, fileUrl, needsTransparency, terminalBackgroundAlpha, toAppearanceDom, toTerminalAppearance } from './map'

const base: AppearanceSettings = DEFAULT_SETTINGS.appearance
const gradient: AppearanceSettings = { ...base, background: { kind: 'gradient', from: '#112233', to: '#445566', angle: 135 } }
const image: AppearanceSettings = { ...base, background: { kind: 'image', path: '/Users/m/My Pics/a (1).png', dim: 0.4 } }

describe('toTerminalAppearance', () => {
  it('maps font settings one to one', () => {
    expect(toTerminalAppearance({ ...base, latinFont: 'Fira Code', cjkFont: 'Hiragino Sans GB', fontSize: 16, lineHeight: 1.4, ligatures: true })).toEqual({
      fontFamily: 'Fira Code',
      cjkFontFamily: 'Hiragino Sans GB',
      fontSize: 16,
      lineHeight: 1.4,
      ligatures: true,
      backgroundAlpha: 1
    })
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
  it('turns on, fully transparent, for gradient and image backgrounds', () => {
    expect(terminalBackgroundAlpha(gradient)).toBe(0)
    expect(needsTransparency(image)).toBe(true)
  })
})

describe('fileUrl', () => {
  it('encodes spaces, parentheses-safe and non-ASCII segments', () => {
    expect(fileUrl('/Users/m/My Pics/a (1).png')).toBe('file:///Users/m/My%20Pics/a%20(1).png')
    expect(fileUrl('/tmp/壁纸.jpg')).toBe('file:///tmp/%E5%A3%81%E7%BA%B8.jpg')
    expect(fileUrl('/tmp/a"b.png')).toBe('file:///tmp/a%22b.png')
  })
})

describe('backdropCss', () => {
  it('solid uses the terminal color, or nothing when translucent', () => {
    expect(backdropCss(base)).toBe('var(--term-bg)')
    expect(backdropCss({ ...base, terminalOpacity: 0.7 })).toBe('transparent')
  })
  it('gradient is a CSS linear-gradient', () => {
    expect(backdropCss(gradient)).toBe('linear-gradient(135deg, #112233, #445566)')
  })
  it('image is cover-fitted with a theme-colored dim veil on top', () => {
    const css = backdropCss(image)
    expect(css).toContain('url("file:///Users/m/My%20Pics/a%20(1).png") center / cover no-repeat')
    expect(css).toContain('color-mix(in srgb, var(--term-bg) 40%, transparent)')
    expect(css.indexOf('color-mix')).toBeLessThan(css.indexOf('url('))
  })
})

describe('toAppearanceDom', () => {
  it('exposes background kind and vibrancy as data attributes', () => {
    expect(toAppearanceDom({ ...gradient, sidebarVibrancy: true }).data).toEqual({ bg: 'gradient', vibrancy: 'on' })
    expect(toAppearanceDom(base).data).toEqual({ bg: 'solid', vibrancy: 'off' })
  })
  it('lets the surface layers go transparent only when the terminal is', () => {
    expect(toAppearanceDom(base).vars['--tr-term-surface']).toBe('var(--term-bg)')
    expect(toAppearanceDom(image).vars['--tr-term-surface']).toBe('transparent')
  })
})
