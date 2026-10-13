import { describe, expect, it } from 'vitest'
import { macKeyToBytes, type KeyLike } from './keymap'

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  metaKey: false,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...mods
})

describe('macKeyToBytes', () => {
  it('maps command shortcuts to readline controls', () => {
    expect(macKeyToBytes(key('Backspace', { metaKey: true }))).toBe('\x15')
    expect(macKeyToBytes(key('ArrowLeft', { metaKey: true }))).toBe('\x01')
    expect(macKeyToBytes(key('ArrowRight', { metaKey: true }))).toBe('\x05')
  })

  it('maps option arrows to word motion', () => {
    expect(macKeyToBytes(key('ArrowLeft', { altKey: true }))).toBe('\x1bb')
    expect(macKeyToBytes(key('ArrowRight', { altKey: true }))).toBe('\x1bf')
  })

  it('leaves everything else to xterm', () => {
    expect(macKeyToBytes(key('ArrowLeft'))).toBeNull()
    expect(macKeyToBytes(key('a', { metaKey: true }))).toBeNull()
    expect(macKeyToBytes(key('ArrowLeft', { metaKey: true, shiftKey: true }))).toBeNull()
    expect(macKeyToBytes(key('ArrowLeft', { metaKey: true, altKey: true }))).toBeNull()
    expect(macKeyToBytes(key('Backspace', { metaKey: true, isComposing: true }))).toBeNull()
  })
})
