import { describe, expect, it } from 'vitest'
import { linkHint, linkTarget, openableUrl, URL_PATTERN } from './links'

describe('openableUrl', () => {
  it('keeps http(s) URLs, normalized', () => {
    expect(openableUrl('http://localhost:5173')).toBe('http://localhost:5173/')
    expect(openableUrl(' https://claude.ai/artifact/abc ')).toBe('https://claude.ai/artifact/abc')
  })

  it('refuses other protocols and junk', () => {
    expect(openableUrl('file:///etc/passwd')).toBeNull()
    expect(openableUrl('javascript:alert(1)')).toBeNull()
    expect(openableUrl('localhost:5173')).toBeNull()
    expect(openableUrl('')).toBeNull()
    expect(openableUrl(`https://a.dev/${'x'.repeat(9000)}`)).toBeNull()
  })
})

describe('linkTarget', () => {
  it('opens the built-in browser on a plain click and the system browser on ⌘-click', () => {
    expect(linkTarget({ metaKey: false })).toBe('internal')
    expect(linkTarget({ metaKey: true })).toBe('external')
  })
})

describe('linkHint', () => {
  it('shows the real address first', () => {
    expect(linkHint({ kind: 'url', url: 'https://example.com/' }).split('\n')[0]).toBe('https://example.com/')
  })

  it('shows the path and line of a file link', () => {
    expect(linkHint({ kind: 'file', path: 'src/a.ts', line: 3, column: null })).toBe('src/a.ts:3\n单击预览 · ⌘ 单击用默认编辑器打开')
  })
})

/** What WebLinksAddon links in a line: every match of the pattern (it adds the `g` flag), as text. */
const urls = (line: string, pattern: RegExp = URL_PATTERN): string[] =>
  [...line.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))].map((match) => match[0])

/** The addon's own default pattern (@xterm/addon-web-links 0.12), for comparing ASCII behaviour. */
// eslint-disable-next-line no-useless-escape -- copied verbatim from the addon
const ADDON_DEFAULT = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\\^<>`]*[^\s"':,.!?{}|\\\^~\[\]`()<>]/

describe('URL_PATTERN', () => {
  it('has no g flag of its own (the addon adds one)', () => {
    expect(URL_PATTERN.flags).not.toContain('g')
  })

  it('stops at full-width and CJK punctuation right after a URL (orca#30213)', () => {
    expect(urls('https://x.com/a。现在可以了')).toEqual(['https://x.com/a'])
    expect(urls('详见 https://github.com/a/b/issues/21106。现在不用你做事。')).toEqual(['https://github.com/a/b/issues/21106'])
    expect(urls('打开 https://example.com/x，然后刷新')).toEqual(['https://example.com/x'])
    expect(urls('https://a.com/x、https://b.com/y；https://c.com/z：完')).toEqual(['https://a.com/x', 'https://b.com/y', 'https://c.com/z'])
    expect(urls('真的吗https://a.com/x？是的https://b.com/y！')).toEqual(['https://a.com/x', 'https://b.com/y'])
    expect(urls('（https://a.com/x）「https://b.com/y」『https://c.com/z』【https://d.com/w】《https://e.com/v》')).toEqual([
      'https://a.com/x',
      'https://b.com/y',
      'https://c.com/z',
      'https://d.com/w',
      'https://e.com/v'
    ])
    expect(urls('“https://a.com/x”……——https://b.com/y→下一步')).toEqual(['https://a.com/x', 'https://b.com/y'])
  })

  it('stops at CJK text glued to a URL', () => {
    expect(urls('https://x.com/a现在可以了')).toEqual(['https://x.com/a'])
    expect(urls('访问http://localhost:5173/查看')).toEqual(['http://localhost:5173/'])
    expect(urls('https://a.com/x日本語とhttps://b.com/y한국어')).toEqual(['https://a.com/x', 'https://b.com/y'])
    expect(urls('https://a.com/x\u3000全角空格')).toEqual(['https://a.com/x'])
  })

  it('keeps percent-encoded paths, query strings and fragments whole', () => {
    expect(urls('https://zh.wikipedia.org/wiki/%E4%B8%AD%E6%96%87。')).toEqual(['https://zh.wikipedia.org/wiki/%E4%B8%AD%E6%96%87'])
    expect(urls('https://a.com/search?q=%E4%B8%AD&lang=zh-CN#top，好')).toEqual(['https://a.com/search?q=%E4%B8%AD&lang=zh-CN#top'])
    expect(urls('http://[::1]:8080/a-b_c~d/?x=1;y=2')).toEqual(['http://[::1]:8080/a-b_c~d/?x=1;y=2'])
  })

  it('keeps balanced ASCII parentheses and leaves out the ones around a URL', () => {
    expect(urls('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
    expect(urls('(see https://en.wikipedia.org/wiki/Foo_(bar))')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
    expect(urls('（见 https://en.wikipedia.org/wiki/Foo_(bar)）')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
    expect(urls('(https://a.com/x)')).toEqual(['https://a.com/x'])
    expect(urls('https://a.com/x(1 more')).toEqual(['https://a.com/x'])
  })

  it('matches the addon default on ASCII text without parentheses', () => {
    const lines = [
      'see https://a.com/x.',
      'https://a.com/x?y=1, then',
      "'https://a.com/x' and \"https://b.com/y\"",
      'https://a.com/x!',
      'go to http://localhost:5173/ now',
      'HTTPS://A.COM/X:',
      '<https://a.com/x>',
      '`https://a.com/x`',
      'https://user:pw@a.com:8443/p/a/t/h?q=1&r[]=2#frag~',
      'https://a.com/*x*'
    ]
    for (const line of lines) expect(urls(line), line).toEqual(urls(line, ADDON_DEFAULT))
  })
})
