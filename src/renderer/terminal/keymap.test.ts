import { describe, expect, it } from 'vitest'
import { defersToTextInput, macKeyToBytes, type KeyLike } from './keymap'

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

describe('defersToTextInput', () => {
  it('leaves plain printable keys to the keypress, so an IME can swap the character (orca#6147)', () => {
    for (const k of [',', '.', '!', '?', ';', ':', '(', '\\', 'a', 'Z', '1', ' ']) expect(defersToTextInput(key(k)), k).toBe(true)
    expect(defersToTextInput(key('<', { shiftKey: true }))).toBe(true)
    expect(defersToTextInput(key('，'))).toBe(true)
  })

  it('keeps keys that are no character, shortcuts and IME keys on the keydown path', () => {
    for (const k of ['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowLeft', 'Dead', 'Process', 'F1']) expect(defersToTextInput(key(k)), k).toBe(false)
    expect(defersToTextInput(key('c', { ctrlKey: true }))).toBe(false)
    expect(defersToTextInput(key('k', { metaKey: true }))).toBe(false)
    expect(defersToTextInput(key('ç', { altKey: true }))).toBe(false)
    expect(defersToTextInput(key(',', { isComposing: true }))).toBe(false)
    expect(defersToTextInput(key('1', { keyCode: 229 }))).toBe(false)
  })
})
