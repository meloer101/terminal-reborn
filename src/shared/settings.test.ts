import { describe, expect, it } from 'vitest'
import { applySettingsPatch, DEFAULT_SETTINGS, sanitizeSettings } from './settings'

describe('sanitizeSettings', () => {
  it('returns defaults for garbage', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings({ appearance: 42 })).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps numbers and rejects bad values field by field', () => {
    const s = sanitizeSettings({
      appearance: { fontSize: 100, lineHeight: 0.2, terminalOpacity: 0.1, theme: 'neon', latinFont: '  Menlo ', ligatures: 'yes' }
    })
    expect(s.appearance.fontSize).toBe(28)
    expect(s.appearance.lineHeight).toBe(1)
    expect(s.appearance.terminalOpacity).toBe(0.5)
    expect(s.appearance.theme).toBe('system')
    expect(s.appearance.latinFont).toBe('Menlo')
    expect(s.appearance.ligatures).toBe(false)
  })

  it('drops the old gradient / image background: the terminal follows the theme (v1.2)', () => {
    const s = sanitizeSettings({ appearance: { background: { kind: 'gradient', from: '#1f1f1f', to: '#050505', angle: 160 }, fontSize: 14 } })
    expect(s.appearance).not.toHaveProperty('background')
    expect(s.appearance.fontSize).toBe(14)
  })
})

describe('applySettingsPatch', () => {
  it('merges appearance fields and keeps the rest', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { appearance: { cjkFont: 'Noto Sans SC', fontSize: 14 } })
    expect(next.appearance.cjkFont).toBe('Noto Sans SC')
    expect(next.appearance.fontSize).toBe(14)
    expect(next.appearance.latinFont).toBe(DEFAULT_SETTINGS.appearance.latinFont)
  })

  it('ignores junk patches', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, 'x')).toEqual(DEFAULT_SETTINGS)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { appearance: { fontSize: 'big' } })).toEqual(DEFAULT_SETTINGS)
  })
})
