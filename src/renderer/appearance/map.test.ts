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
  sidebarOpacity,
  toTerminalAppearance
} from './map'

const base: AppearanceSettings = DEFAULT_SETTINGS.appearance
/** An opaque terminal (the defaults are 85% since PRD v1.179). */
const opaque: AppearanceSettings = { ...base, terminalOpacity: 1 }

describe('toTerminalAppearance', () => {
  it('maps font settings one to one', () => {
    expect(toTerminalAppearance({ ...base, latinFont: 'Fira Code', cjkFont: 'Hiragino Sans GB', fontSize: 16, lineHeight: 1.4, ligatures: true, terminalOpacity: 1 })).toEqual({
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
    expect(terminalBackgroundAlpha(opaque)).toBe(1)
    expect(needsTransparency(opaque)).toBe(false)
  })
  it('turns on for opacity < 1', () => {
    const a = { ...base, terminalOpacity: 0.8 }
    expect(terminalBackgroundAlpha(a)).toBe(0.8)
    expect(needsTransparency(a)).toBe(true)
  })
})

describe('backdropCss', () => {
  it('is the theme terminal color, or nothing when translucent', () => {
    expect(backdropCss(opaque)).toBe('var(--term-bg)')
    expect(backdropCss({ ...base, terminalOpacity: 0.7 })).toBe('transparent')
  })
})

describe('ringCss', () => {
  it('repeats the cell color at the terminal opacity around the canvas, nothing when opaque', () => {
    expect(ringCss(opaque)).toBe('transparent')
    expect(ringCss({ ...base, terminalOpacity: 0.72 })).toBe('color-mix(in srgb, var(--term-bg) 72%, transparent)')
  })
})

describe('toAppearanceDom', () => {
  it('lets the surface layers go transparent only when the terminal is', () => {
    expect(toAppearanceDom(opaque, false).vars['--tr-term-surface']).toBe('var(--term-bg)')
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

  it('reads as today by default: 720 column, system UI font first, 14 / 22; cards at 85% (PRD v1.179)', () => {
    const vars = toAppearanceDom(base, true).vars
    expect(vars['--chat-column']).toBe('720px')
    expect(vars['--chat-font']).toBe('-apple-system, BlinkMacSystemFont, "PingFang SC", var(--font-ui)')
    expect(vars['--chat-leading']).toBe('22px')
    expect(vars['--tr-chat-bg']).toBe('color-mix(in srgb, var(--bg-app) 85%, transparent)')
    expect(vars['--tr-term-ring']).toBe('color-mix(in srgb, var(--term-bg) 85%, transparent)')
  })

  it('the sidebar is one step (10%) more opaque than the current session’s card; the right panel matches the card (PRD v1.179)', () => {
    const a = { ...base, terminalOpacity: 0.5, chat: { ...base.chat, opacity: 0.3 } }
    const vars = toAppearanceDom(a, true).vars
    expect(vars['--tr-sidebar-cli']).toBe('color-mix(in srgb, var(--glass-shell-color) 60%, transparent)')
    expect(vars['--tr-sidebar-gui']).toBe('color-mix(in srgb, var(--glass-shell-color) 40%, transparent)')
    expect(vars['--tr-panel-cli']).toBe('color-mix(in srgb, var(--bg-app) 50%, transparent)')
    expect(vars['--tr-panel-gui']).toBe('color-mix(in srgb, var(--bg-app) 30%, transparent)')
    // The defaults: cards 85%, sidebar 95%. Above 90% the sidebar is opaque.
    expect(toAppearanceDom(base, true).vars['--tr-sidebar-cli']).toBe('color-mix(in srgb, var(--glass-shell-color) 95%, transparent)')
    const opaque = toAppearanceDom({ ...a, terminalOpacity: 0.95 }, false).vars
    expect(opaque['--tr-sidebar-cli']).toBe('var(--glass-shell-color)')
    expect(sidebarOpacity(0.95)).toBe(1)
    expect(sidebarOpacity(0.2)).toBeCloseTo(0.3)
  })

  it('实色 (PRD v1.139, Figma 57): an opaque shell on every macOS, named on <html> for the softened tokens', () => {
    const a = { ...base, windowMaterial: 'solid' as const, terminalOpacity: 0.4 }
    expect(shownMaterial(a, true)).toBe('solid')
    expect(shownMaterial(a, false)).toBe('solid')
    const dom = toAppearanceDom(a, false)
    expect(dom.vars['--tr-sidebar-cli']).toBe('var(--glass-shell-color)')
    expect(dom.vars['--tr-sidebar-gui']).toBe('var(--glass-shell-color)')
    expect(dom.vars['--tr-panel-cli']).toBe('var(--bg-app)')
    expect(dom.attrs['data-material']).toBe('solid')
    expect(toAppearanceDom({ ...a, windowMaterial: 'glass' }, false).attrs['data-material']).toBe('frosted')
  })

  it('实色 makes everything solid (Figma 66): the terminal and chat cards ignore their opacity, which stays saved', () => {
    const a = { ...base, windowMaterial: 'solid' as const, terminalOpacity: 0.6, chat: { ...base.chat, opacity: 0.7 } }
    expect(terminalBackgroundAlpha(a)).toBe(1)
    expect(needsTransparency(a)).toBe(false)
    expect(toTerminalAppearance(a).backgroundAlpha).toBe(1)
    const vars = toAppearanceDom(a, true).vars
    expect(vars['--tr-chat-bg']).toBe('var(--bg-app)')
    expect(vars['--tr-terminal-backdrop']).toBe('var(--term-bg)')
    expect(vars['--tr-term-surface']).toBe('var(--term-bg)')
    expect(vars['--tr-term-ring']).toBe('transparent')
    // Back on glass, the saved values apply again.
    const glass = toAppearanceDom({ ...a, windowMaterial: 'glass' }, true).vars
    expect(glass['--tr-chat-bg']).toBe('color-mix(in srgb, var(--bg-app) 70%, transparent)')
    expect(glass['--tr-term-ring']).toBe('color-mix(in srgb, var(--term-bg) 60%, transparent)')
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
