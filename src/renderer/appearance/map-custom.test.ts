import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AppearanceSettings } from '@shared/settings'
import { toAppearanceDom, toTerminalAppearance } from './map'

const base: AppearanceSettings = DEFAULT_SETTINGS.appearance
const custom: AppearanceSettings = { ...base, terminalBackground: { mode: 'custom', color: '#262427' } }

describe('custom terminal background', () => {
  it('leaves --term-bg and the xterm theme to the app theme by default', () => {
    expect(toAppearanceDom(base).vars['--term-bg']).toBeNull()
    expect(toTerminalAppearance(base)).toHaveProperty('customTheme', undefined)
  })

  it('sets --term-bg and hands xterm the matching colors', () => {
    expect(toAppearanceDom(custom).vars['--term-bg']).toBe('#262427')
    expect(toTerminalAppearance(custom).customTheme?.background).toBe('#262427')
  })

  it('keeps the remembered color out of effect while the mode is theme', () => {
    const remembered: AppearanceSettings = { ...base, terminalBackground: { mode: 'theme', color: '#262427' } }
    expect(toAppearanceDom(remembered).vars['--term-bg']).toBeNull()
    expect(toTerminalAppearance(remembered).customTheme).toBeUndefined()
  })
})
