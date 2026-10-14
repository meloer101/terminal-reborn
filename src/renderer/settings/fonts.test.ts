import { describe, expect, it } from 'vitest'
import { BUNDLED_LATIN_FONT, classifyFonts, DEFAULT_CJK_FONT, looksCjk, looksMonospace, uniqueFamilies, withCurrent } from './fonts'

describe('looksMonospace', () => {
  it('recognises common terminal families', () => {
    for (const name of ['JetBrains Mono', 'SF Mono', 'Menlo', 'Fira Code', 'Source Code Pro', 'Cascadia Code', 'Iosevka', 'Hack']) {
      expect(looksMonospace(name), name).toBe(true)
    }
  })
  it('rejects proportional families', () => {
    for (const name of ['Helvetica Neue', 'Georgia', 'Arial']) expect(looksMonospace(name), name).toBe(false)
  })
})

describe('looksCjk', () => {
  it('recognises CJK families', () => {
    for (const name of ['PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Noto Sans CJK JP', 'Source Han Sans SC', '思源黑体', 'Songti SC', 'STHeiti', 'Kaiti TC']) {
      expect(looksCjk(name), name).toBe(true)
    }
  })
  it('does not flag Latin families', () => {
    for (const name of ['Noto Sans', 'Helvetica', 'JetBrains Mono', 'Scientifica']) expect(looksCjk(name), name).toBe(false)
  })
})

describe('uniqueFamilies', () => {
  it('dedupes, trims, drops hidden faces and sorts', () => {
    expect(uniqueFamilies(['b', 'A', ' b ', '.SF NS', '', 'a'])).toEqual(['A', 'a', 'b'])
  })
})

describe('classifyFonts', () => {
  const installed = ['Menlo', 'Helvetica', 'PingFang SC', 'Hiragino Sans GB', 'Fira Code', 'Zapfino']
  it('splits into latin monospace and cjk, pinning the bundled families first', () => {
    const { latin, cjk } = classifyFonts(installed)
    expect(latin).toEqual([BUNDLED_LATIN_FONT, 'Fira Code', 'Menlo'])
    expect(cjk).toEqual([DEFAULT_CJK_FONT, 'Hiragino Sans GB'])
  })
  it('uses the measured check for unknown names', () => {
    const { latin } = classifyFonts(installed, (family) => family === 'Zapfino')
    expect(latin).toContain('Zapfino')
    expect(latin).not.toContain('Helvetica')
  })
  it('still offers the defaults with an empty list', () => {
    expect(classifyFonts([])).toEqual({ latin: [BUNDLED_LATIN_FONT], cjk: [DEFAULT_CJK_FONT] })
  })
})

describe('withCurrent', () => {
  it('prepends a family that is not listed', () => {
    expect(withCurrent(['a'], 'b')).toEqual(['b', 'a'])
    expect(withCurrent(['a', 'b'], 'b')).toEqual(['a', 'b'])
  })
})
