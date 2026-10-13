import { describe, expect, it } from 'vitest'
import { buildFontStack, buildXtermTheme, mixHex } from './appearance'

describe('buildFontStack', () => {
  it('quotes families and always includes a CJK family before monospace', () => {
    expect(buildFontStack({ fontFamily: 'JetBrains Mono Variable', cjkFontFamily: 'PingFang SC' })).toBe(
      '"JetBrains Mono Variable", "PingFang SC", monospace'
    )
  })
  it('leaves quoted names and stacks alone', () => {
    expect(buildFontStack({ fontFamily: '"Fira Code", Menlo', cjkFontFamily: "'Hiragino Sans'" })).toBe(
      '"Fira Code", Menlo, \'Hiragino Sans\', monospace'
    )
  })
})

describe('mixHex', () => {
  it('blends and ignores non-hex input', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('red', '#ffffff', 0.5)).toBe('red')
  })
})

describe('buildXtermTheme', () => {
  const dark: Record<string, string> = {
    '--term-bg': '#0a0a0a',
    '--term-fg': '#e5e5e5',
    '--term-dim': '#808080',
    '--term-red': '#ff5c5c',
    '--term-green': '#3dd68c',
    '--term-yellow': '#e8c46a',
    '--term-blue': '#5ea1ff',
    '--term-violet': '#c79bff',
    '--term-cyan': '#6ccfd6',
    '--term-selection': '#5ea1ff47'
  }

  it('maps tokens onto the ANSI palette', () => {
    const theme = buildXtermTheme((name) => dark[name] ?? '')
    expect(theme.background).toBe('#0a0a0a')
    expect(theme.foreground).toBe('#e5e5e5')
    expect(theme.green).toBe('#3dd68c')
    expect(theme.magenta).toBe('#c79bff')
    expect(theme.brightBlack).toBe('#808080')
    expect(theme.selectionBackground).toBe('#5ea1ff47')
  })

  it('flips the neutrals on a light background', () => {
    const light: Record<string, string> = { ...dark, '--term-bg': '#ffffff', '--term-fg': '#121212' }
    const theme = buildXtermTheme((name) => light[name] ?? '')
    expect(theme.black).toBe('#121212')
    expect(theme.white).not.toBe('#ffffff')
  })
})
