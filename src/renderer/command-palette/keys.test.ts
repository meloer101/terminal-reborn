import { describe, expect, it } from 'vitest'
import { decidePaletteKey, isImeEvent, isPaletteShortcut, type KeyFacts } from './keys'

const key = (key: string, extra: Partial<KeyFacts> = {}): KeyFacts => ({
  key,
  keyCode: 0,
  isComposing: false,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...extra
})

describe('isPaletteShortcut', () => {
  it.each([
    [key('k', { metaKey: true }), true],
    [key('K', { metaKey: true }), true],
    [key('k'), false],
    [key('k', { ctrlKey: true }), false],
    [key('k', { metaKey: true, shiftKey: true }), false],
    [key('k', { metaKey: true, altKey: true }), false],
    [key('j', { metaKey: true }), false]
  ])('%j -> %s', (facts, expected) => {
    expect(isPaletteShortcut(facts)).toBe(expected)
  })
})

describe('decidePaletteKey', () => {
  it.each([
    [key('ArrowDown'), 'next'],
    [key('ArrowUp'), 'prev'],
    [key('Tab'), 'next'],
    [key('Tab', { shiftKey: true }), 'prev'],
    [key('n', { ctrlKey: true }), 'next'],
    [key('p', { ctrlKey: true }), 'prev'],
    [key('Enter'), 'run'],
    [key('Escape'), 'close'],
    [key('k', { metaKey: true }), 'toggle'],
    [key('a'), null],
    [key('ArrowLeft'), null],
    [key('Enter', { shiftKey: true }), null],
    [key('Enter', { metaKey: true }), null],
    [key('a', { metaKey: true }), null]
  ])('%j -> %s', (facts, expected) => {
    expect(decidePaletteKey(facts)).toBe(expected)
  })

  it.each([
    ['isComposing', key('Enter', { isComposing: true })],
    ['keyCode 229', key('Enter', { keyCode: 229 })],
    ["key 'Process'", key('Process')],
    ['arrow while composing', key('ArrowDown', { isComposing: true })],
    ['escape while composing', key('Escape', { isComposing: true })]
  ])('ignores IME events: %s', (_name, facts) => {
    expect(decidePaletteKey(facts)).toBeNull()
  })
})

describe('isImeEvent', () => {
  it('covers all three signals', () => {
    expect(isImeEvent({ isComposing: true, keyCode: 13, key: 'Enter' })).toBe(true)
    expect(isImeEvent({ isComposing: false, keyCode: 229, key: 'Enter' })).toBe(true)
    expect(isImeEvent({ isComposing: false, keyCode: 13, key: 'Process' })).toBe(true)
    expect(isImeEvent({ isComposing: false, keyCode: 13, key: 'Enter' })).toBe(false)
  })
})
