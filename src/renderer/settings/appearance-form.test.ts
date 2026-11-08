import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AppearanceSettings } from '@shared/settings'
import { RESET_KEYS, displayFamily, fontSizeOptions, formatPercent, isPageDefault, materialOptions, pageDefaults, previewCaption } from './appearance-form'

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

describe('materialOptions (PRD v1.139, Figma 57C)', () => {
  it('offers Liquid Glass only where the window has it; 实色 everywhere', () => {
    expect(materialOptions(true).map((o) => o.label)).toEqual(['液态玻璃', '磨砂玻璃', '实色'])
    expect(materialOptions(false).map((o) => o.label)).toEqual(['磨砂玻璃', '实色'])
  })
})

describe('恢复默认 per page (Figma 66)', () => {
  it('every appearance setting belongs to exactly one page, except the theme and 全屏背景', () => {
    const owned = Object.values(RESET_KEYS).flat()
    expect(new Set(owned).size).toBe(owned.length)
    expect([...owned, 'theme', 'fullscreenBackdrop'].sort()).toEqual(Object.keys(DEFAULT_SETTINGS.appearance).sort())
  })

  it('resets only its own page', () => {
    const a = { ...DEFAULT_SETTINGS.appearance, theme: 'light' as const, fontSize: 18, windowMaterial: 'solid' as const, chat: { ...DEFAULT_SETTINGS.appearance.chat, fontSize: 16 } }
    expect(isPageDefault(a, 'terminal')).toBe(false)
    expect(pageDefaults('terminal')).toMatchObject({ fontSize: DEFAULT_SETTINGS.appearance.fontSize })
    expect(pageDefaults('terminal')).not.toHaveProperty('chat')
    expect(isPageDefault({ ...a, ...(pageDefaults('appearance') as Partial<AppearanceSettings>) }, 'appearance')).toBe(true)
    expect(isPageDefault(a, 'chat')).toBe(false)
  })
})
