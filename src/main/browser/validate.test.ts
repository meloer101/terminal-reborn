import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_REMEMBERED, RememberedPages, sanitizeRemembered } from './remembered'
import { parseBoolean, parseBounds, parseUrl, parseWorktree } from './validate'

describe('browser payload validation', () => {
  it('accepts only absolute worktree paths', () => {
    expect(parseWorktree('/Users/a/repo')).toBe('/Users/a/repo')
    for (const bad of ['', 'repo', '../x', '/a\0b', 42, null, '/'.repeat(5000)]) expect(() => parseWorktree(bad)).toThrow()
  })

  it('accepts only http(s) URLs', () => {
    expect(parseUrl('http://localhost:5173')).toBe('http://localhost:5173/')
    for (const bad of ['file:///etc/hosts', 'javascript:alert(1)', 'about:blank', 'x', 7]) expect(() => parseUrl(bad)).toThrow()
  })

  it('rounds and clamps bounds, refuses non-numbers', () => {
    expect(parseBounds({ x: 10.4, y: -3, width: 480.6, height: 1e9 })).toEqual({ x: 10, y: 0, width: 481, height: 16_384 })
    for (const bad of [null, {}, { x: 0, y: 0, width: 'a', height: 1 }, { x: NaN, y: 0, width: 1, height: 1 }]) expect(() => parseBounds(bad)).toThrow()
  })

  it('accepts only booleans as flags', () => {
    expect(parseBoolean(true)).toBe(true)
    expect(() => parseBoolean('true')).toThrow()
  })
})

describe('remembered pages', () => {
  it('keeps well-formed http(s) entries only', () => {
    const pages = sanitizeRemembered({
      '/a': { url: 'http://localhost:5173/', mobile: true },
      '/b': { url: 'file:///etc/passwd' },
      relative: { url: 'http://x/' },
      '/c': 'nope',
      '/d': { url: 'https://example.com/' }
    })
    expect([...pages]).toEqual([
      ['/a', { url: 'http://localhost:5173/', mobile: true }],
      ['/d', { url: 'https://example.com/', mobile: false }]
    ])
    expect(sanitizeRemembered(null).size).toBe(0)
    expect(sanitizeRemembered([1]).size).toBe(0)
  })

  it('caps the number of worktrees, dropping the oldest', () => {
    const raw = Object.fromEntries(Array.from({ length: MAX_REMEMBERED + 3 }, (_, i) => [`/w${i}`, { url: 'http://localhost/' }]))
    const pages = sanitizeRemembered(raw)
    expect(pages.size).toBe(MAX_REMEMBERED)
    expect(pages.has('/w0')).toBe(false)
  })

  it('round-trips through the file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'tr-browser-')), 'browser.json')
    writeFileSync(path, '{corrupt')
    const store = new RememberedPages(path)
    expect(store.get('/a')).toBeUndefined()
    store.set('/a', { url: 'http://localhost:3000/x', mobile: false })
    store.flush()
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ '/a': { url: 'http://localhost:3000/x', mobile: false } })
    expect(new RememberedPages(path).get('/a')).toEqual({ url: 'http://localhost:3000/x', mobile: false })
  })
})
