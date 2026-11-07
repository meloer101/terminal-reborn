import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AppearanceSettings } from '@shared/settings'
import {
  backdropCss,
  needsTransparency,
  ringCss,
  terminalBackgroundAlpha,
  toAppearanceDom,
  chatFontStack,
  shownMaterial,
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
    expect(toAppearanceDom(base, false).vars['--tr-term-surface']).toBe('var(--term-bg)')
    expect(toAppearanceDom({ ...base, terminalOpacity: 0.8 }, false).vars['--tr-term-surface']).toBe('transparent')
  })

  it('names the full-screen palette on <html> (auto picks by theme in CSS)', () => {
    expect(toAppearanceDom(base, false).attrs).toEqual({ 'data-fs-backdrop': 'auto', 'data-chat-avatar': 'off', 'data-material': 'frosted' })
    expect(toAppearanceDom({ ...base, fullscreenBackdrop: 'dune' }, false).attrs['data-fs-backdrop']).toBe('dune')
  })
})

describe('对话 and the window base layer (PRD v1.127, Figma 51)', () => {
  it('sets the chat column, font stack, weight, size, leading and card opacity', () => {
    const vars = toAppearanceDom({ ...base, chat: { ...base.chat, width: 'medium', latinFont: 'Inter', cjkFont: 'Source Han Sans SC', fontWeight: 500, fontSize: 16, opacity: 0.85 } }, true).vars
    expect(vars['--chat-column']).toBe('960px')
    expect(vars['--chat-font']).toBe('"Inter", "Source Han Sans SC", var(--font-ui)')
    expect(vars['--chat-weight']).toBe('500')
    expect(vars['--chat-size']).toBe('16px')
    expect(vars['--chat-leading']).toBe('25px')
    expect(vars['--tr-chat-bg']).toBe('color-mix(in srgb, var(--bg-app) 85%, transparent)')
  })

  it('reads as today by default: 720 column, system UI font first, 14 / 22, opaque card, untinted Liquid Glass', () => {
    const vars = toAppearanceDom(base, true).vars
    expect(vars['--chat-column']).toBe('720px')
    expect(vars['--chat-font']).toBe('-apple-system, BlinkMacSystemFont, "PingFang SC", var(--font-ui)')
    expect(vars['--chat-leading']).toBe('22px')
    expect(vars['--tr-chat-bg']).toBe('var(--bg-app)')
    expect(vars['--glass-shell']).toBe('transparent')
  })

  it('tints the base layer by the material shown: frosted before macOS 26 whatever was chosen', () => {
    const a = { ...base, windowMaterial: 'liquid' as const, shellOpacity: { liquid: 0.2, frosted: 0.6 } }
    expect(shownMaterial(a, true)).toBe('liquid')
    expect(toAppearanceDom(a, true).vars['--glass-shell']).toBe('color-mix(in srgb, var(--glass-shell-color) 20%, transparent)')
    expect(shownMaterial(a, false)).toBe('frosted')
    expect(toAppearanceDom(a, false).vars['--glass-shell']).toBe('color-mix(in srgb, var(--glass-shell-color) 60%, transparent)')
    expect(toAppearanceDom({ ...a, windowMaterial: 'frosted', shellOpacity: { liquid: 0, frosted: 1 } }, true).vars['--glass-shell']).toBe('var(--glass-shell-color)')
  })

  it('实色 (PRD v1.139, Figma 57): an opaque shell on every macOS, named on <html> for the softened tokens', () => {
    const a = { ...base, windowMaterial: 'solid' as const, shellOpacity: { liquid: 0, frosted: 0.6 } }
    expect(shownMaterial(a, true)).toBe('solid')
    expect(shownMaterial(a, false)).toBe('solid')
    const dom = toAppearanceDom(a, false)
    expect(dom.vars['--glass-shell']).toBe('var(--glass-shell-color)')
    expect(dom.attrs['data-material']).toBe('solid')
    expect(toAppearanceDom({ ...a, windowMaterial: 'liquid' }, false).attrs['data-material']).toBe('frosted')
  })

  it('shows the user’s picture only when there is one', () => {
    const avatar = 'data:image/webp;base64,UklGRg=='
    const dom = toAppearanceDom({ ...base, chat: { ...base.chat, avatar } }, true)
    expect(dom.vars['--chat-avatar']).toBe(`url("${avatar}")`)
    expect(dom.attrs['data-chat-avatar']).toBe('on')
    expect(toAppearanceDom(base, true).vars['--chat-avatar']).toBeNull()
  })

  it('quotes font names safely', () => {
    expect(chatFontStack({ latinFont: 'Bad"Name\\', cjkFont: 'PingFang SC' })).toBe('"BadName", "PingFang SC", var(--font-ui)')
  })
})
