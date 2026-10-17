import { describe, expect, it } from 'vitest'
import { BUNDLED_LATIN_FONT, cjkGroup, classifyFonts, DEFAULT_CJK_FONT, groupCjkFamilies, looksCjk, looksMonospace, uniqueFamilies, withCurrent } from './fonts'

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
  it('lets the measured check decide when there is one: a code-sounding proportional face stays out', () => {
    const measured = (family: string) => ['Menlo', 'Zapfino'].includes(family)
    const { latin } = classifyFonts([...installed, 'Fira Sans', 'American Typewriter'], measured)
    expect(latin).toEqual([BUNDLED_LATIN_FONT, 'Menlo', 'Zapfino'])
  })
  it('still offers the defaults with an empty list', () => {
    expect(classifyFonts([])).toEqual({ latin: [BUNDLED_LATIN_FONT], cjk: [DEFAULT_CJK_FONT] })
  })
})

describe('cjkGroup', () => {
  it.each([
    ['PingFang SC', '简体中文'],
    ['Hiragino Sans GB', '简体中文'],
    ['Songti SC', '简体中文'],
    ['Source Han Sans SC', '简体中文'],
    ['PingFang TC', '繁体中文'],
    ['PingFang HK', '繁体中文'],
    ['LiHei Pro', '繁体中文'],
    ['Hiragino Sans', '日文'],
    ['Hiragino Mincho ProN', '日文'],
    ['Noto Sans JP', '日文'],
    ['Apple SD Gothic Neo', '韩文'],
    ['Noto Sans KR', '韩文'],
    ['Noto Sans CJK', '其他']
  ])('%s → %s', (family, group) => {
    expect(cjkGroup(family)).toBe(group)
  })

  it('groups in a fixed order, keeping the pinned default first', () => {
    const grouped = groupCjkFamilies(['PingFang SC', 'Hiragino Sans', 'PingFang TC', 'Songti SC'])
    expect(grouped.map((g) => g.family)).toEqual(['PingFang SC', 'Songti SC', 'PingFang TC', 'Hiragino Sans'])
  })
})

describe('withCurrent', () => {
  it('prepends a family that is not listed', () => {
    expect(withCurrent(['a'], 'b')).toEqual(['b', 'a'])
    expect(withCurrent(['a', 'b'], 'b')).toEqual(['a', 'b'])
  })
})
