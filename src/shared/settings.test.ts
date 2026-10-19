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

  it('keeps the TR_PORT base whole and in range (PRD F4)', () => {
    expect(DEFAULT_SETTINGS.ports.base).toBe(41000)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { ports: { base: 50000 } }).ports.base).toBe(50000)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { ports: { base: 80 } }).ports.base).toBe(1024)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { ports: { base: 'x' } }).ports.base).toBe(41000)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { appearance: { fontSize: 14 } }).ports).toEqual(DEFAULT_SETTINGS.ports)
  })

  it('ignores junk patches', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, 'x')).toEqual(DEFAULT_SETTINGS)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { appearance: { fontSize: 'big' } })).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps code review off unless a real switch is set (PRD F13)', () => {
    expect(DEFAULT_SETTINGS.review).toEqual({
      beforeMerge: false,
      beforePush: false,
      afterTurnWithCommits: false,
      mode: 'builtin',
      rules: 'default',
      customRules: '',
      model: ''
    })
    const next = applySettingsPatch(DEFAULT_SETTINGS, { review: { beforeMerge: true, mode: 'agent-command', model: 'haiku', customRules: '只看空指针' } })
    expect(next.review.beforeMerge).toBe(true)
    expect(next.review.beforePush).toBe(false)
    expect(next.review.mode).toBe('agent-command')
    expect(next.review.model).toBe('haiku')
    expect(next.review.rules).toBe('default')
    expect(applySettingsPatch(DEFAULT_SETTINGS, { review: { model: 'not a model', mode: 'nope' } }).review.model).toBe('')
    expect(applySettingsPatch(DEFAULT_SETTINGS, { review: { mode: 'nope' } }).review.mode).toBe('builtin')
    expect(applySettingsPatch(DEFAULT_SETTINGS, { appearance: { fontSize: 14 } }).review).toEqual(DEFAULT_SETTINGS.review)
  })
})

describe('archive settings (F15)', () => {
  it('starts with 合并后自动归档 off and takes a boolean patch only', () => {
    expect(DEFAULT_SETTINGS.archive.afterMerge).toBe(false)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { archive: { afterMerge: true } }).archive.afterMerge).toBe(true)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { archive: { afterMerge: 'yes' } }).archive.afterMerge).toBe(false)
    expect(sanitizeSettings({}).archive).toEqual({ afterMerge: false })
  })
})
