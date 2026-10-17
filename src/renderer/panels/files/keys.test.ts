import { describe, expect, it } from 'vitest'
import { fileActionForKey, isFileAction } from './keys'

const key = (k: string, code: string, mods: Partial<Record<'metaKey' | 'shiftKey' | 'altKey' | 'ctrlKey', boolean>> = {}) => ({
  key: k,
  code,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  ...mods
})

describe('fileActionForKey', () => {
  it('maps the context menu shortcuts', () => {
    expect(fileActionForKey(key('Enter', 'Enter'))).toBe('preview')
    expect(fileActionForKey(key('Enter', 'Enter', { metaKey: true }))).toBe('open')
    expect(fileActionForKey(key('R', 'KeyR', { metaKey: true, shiftKey: true }))).toBe('reveal')
    expect(fileActionForKey(key('I', 'KeyI', { metaKey: true, shiftKey: true }))).toBe('insert')
    // ⌥ changes the character; the physical key still counts.
    expect(fileActionForKey(key('ç', 'KeyC', { metaKey: true, altKey: true }))).toBe('copy')
  })

  it('leaves everything else alone', () => {
    expect(fileActionForKey(key('c', 'KeyC', { metaKey: true }))).toBeNull()
    expect(fileActionForKey(key('Enter', 'Enter', { shiftKey: true }))).toBeNull()
    expect(fileActionForKey(key('Enter', 'Enter', { ctrlKey: true }))).toBeNull()
    expect(fileActionForKey(key('r', 'KeyR'))).toBeNull()
  })
})

describe('isFileAction', () => {
  it('accepts only menu item ids', () => {
    expect(isFileAction('copy')).toBe(true)
    expect(isFileAction('toString')).toBe(false)
    expect(isFileAction(null)).toBe(false)
  })
})
