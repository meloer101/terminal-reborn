import { describe, expect, it } from 'vitest'
import { linkHint, linkTarget, openableUrl } from './links'

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
    expect(linkHint('https://example.com/').split('\n')[0]).toBe('https://example.com/')
  })
})
