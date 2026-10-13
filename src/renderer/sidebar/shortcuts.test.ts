import { describe, expect, it } from 'vitest'
import { resolveShortcut, type KeyLike } from './shortcuts'

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods
})

describe('resolveShortcut', () => {
  it('maps ⌘1–⌘9', () => {
    expect(resolveShortcut(key('1'))).toEqual({ type: 'nth', n: 1 })
    expect(resolveShortcut(key('9'))).toEqual({ type: 'nth', n: 9 })
  })
  it('ignores ⌘0', () => {
    expect(resolveShortcut(key('0'))).toBeNull()
  })
  it('maps ⌘J in either case', () => {
    expect(resolveShortcut(key('j'))).toEqual({ type: 'next-attention' })
    expect(resolveShortcut(key('J'))).toEqual({ type: 'next-attention' })
  })
  it('requires ⌘ alone', () => {
    expect(resolveShortcut(key('1', { metaKey: false }))).toBeNull()
    expect(resolveShortcut(key('1', { shiftKey: true }))).toBeNull()
    expect(resolveShortcut(key('j', { altKey: true }))).toBeNull()
    expect(resolveShortcut(key('j', { ctrlKey: true }))).toBeNull()
  })
  it('ignores other keys', () => {
    expect(resolveShortcut(key('k'))).toBeNull()
  })
})
