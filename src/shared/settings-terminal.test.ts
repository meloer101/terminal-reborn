import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, applySettingsPatch, sanitizeSettings } from './settings'

const ANSI = Array.from({ length: 16 }, (_, i) => `#${i.toString(16).repeat(6)}`)
const COLORS = { foreground: '#fcfcfa', cursor: '#fcfcfa', selection: '#5ea1ff47', ansi: ANSI }

describe('terminal background settings', () => {
  it('follows the theme by default, remembering a color for the custom mode', () => {
    expect(DEFAULT_SETTINGS.appearance.terminalBackground).toEqual({ mode: 'theme', color: '#0a0a0a' })
    expect(DEFAULT_SETTINGS.appearance.terminalColors).toBeNull()
    expect(sanitizeSettings(null).appearance.terminalBackground).toEqual({ mode: 'theme', color: '#0a0a0a' })
  })

  it('keeps a custom background and normalizes its color', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { appearance: { terminalBackground: { mode: 'custom', color: '#FDF6E3' } } })
    expect(next.appearance.terminalBackground).toEqual({ mode: 'custom', color: '#fdf6e3' })
  })

  it('keeps the color when the mode goes back to the theme', () => {
    const custom = applySettingsPatch(DEFAULT_SETTINGS, { appearance: { terminalBackground: { mode: 'custom', color: '#262427' } } })
    const back = applySettingsPatch(custom, { appearance: { terminalBackground: { mode: 'theme', color: '#262427' } } })
    expect(back.appearance.terminalBackground).toEqual({ mode: 'theme', color: '#262427' })
  })

  it('falls back for a bad mode or color instead of breaking', () => {
    const next = sanitizeSettings({ appearance: { terminalBackground: { mode: 'gradient', color: 'linear-gradient(red, blue)' } } })
    expect(next.appearance.terminalBackground).toEqual({ mode: 'theme', color: '#0a0a0a' })
    expect(sanitizeSettings({ appearance: { terminalBackground: 'red' } }).appearance.terminalBackground.mode).toBe('theme')
  })

  it('keeps imported colors that are complete', () => {
    expect(sanitizeSettings({ appearance: { terminalColors: COLORS } }).appearance.terminalColors).toEqual(COLORS)
  })

  it('drops imported colors that are incomplete or malformed, all together', () => {
    for (const bad of [
      { ...COLORS, ansi: ANSI.slice(0, 15) },
      { ...COLORS, ansi: [...ANSI.slice(0, 15), 'blue'] },
      { ...COLORS, foreground: 'white' },
      { ...COLORS, selection: '#12345' },
      'x',
      null
    ]) {
      expect(sanitizeSettings({ appearance: { terminalColors: bad } }).appearance.terminalColors).toBeNull()
    }
  })

  it('clears imported colors when the patch says null', () => {
    const imported = applySettingsPatch(DEFAULT_SETTINGS, { appearance: { terminalColors: COLORS } })
    expect(imported.appearance.terminalColors).toEqual(COLORS)
    expect(applySettingsPatch(imported, { appearance: { terminalColors: null } }).appearance.terminalColors).toBeNull()
  })
})
