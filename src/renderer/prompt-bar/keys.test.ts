import { describe, expect, it } from 'vitest'
import { decideDigitKey, type DigitKeyFacts, type FocusKind } from './keys'

const key = (over: Partial<DigitKeyFacts> = {}): DigitKeyFacts => ({
  code: 'Digit2',
  key: '2',
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  isComposing: false,
  keyCode: 50,
  ...over
})
const emptyComposer: FocusKind = { type: 'composer', empty: true }
const typedComposer: FocusKind = { type: 'composer', empty: false }

describe('decideDigitKey', () => {
  it('plain digits choose while the composer is empty or focus is elsewhere', () => {
    expect(decideDigitKey(key(), emptyComposer)).toBe(2)
    expect(decideDigitKey(key(), { type: 'elsewhere' })).toBe(2)
    expect(decideDigitKey(key({ code: 'Digit9', key: '9' }), emptyComposer)).toBe(9)
    expect(decideDigitKey(key({ code: 'Numpad1', key: '1' }), emptyComposer)).toBe(1)
  })

  it('with text in the composer a plain digit is just text, ⌥digit chooses', () => {
    expect(decideDigitKey(key(), typedComposer)).toBeNull()
    expect(decideDigitKey(key({ altKey: true, key: '™' }), typedComposer)).toBe(2)
    expect(decideDigitKey(key({ altKey: true, key: '™' }), emptyComposer)).toBe(2)
  })

  it('never inside the bar field or another text field', () => {
    expect(decideDigitKey(key(), { type: 'bar-input' })).toBeNull()
    expect(decideDigitKey(key({ altKey: true }), { type: 'bar-input' })).toBeNull()
    expect(decideDigitKey(key(), { type: 'other-input' })).toBeNull()
  })

  it('ignores zero, other keys, shortcuts and IME composition', () => {
    expect(decideDigitKey(key({ code: 'Digit0', key: '0' }), emptyComposer)).toBeNull()
    expect(decideDigitKey(key({ code: 'KeyA', key: 'a' }), emptyComposer)).toBeNull()
    expect(decideDigitKey(key({ metaKey: true }), emptyComposer)).toBeNull()
    expect(decideDigitKey(key({ ctrlKey: true }), emptyComposer)).toBeNull()
    expect(decideDigitKey(key({ shiftKey: true }), emptyComposer)).toBeNull()
    expect(decideDigitKey(key({ isComposing: true }), emptyComposer)).toBeNull()
    expect(decideDigitKey(key({ keyCode: 229 }), emptyComposer)).toBeNull()
  })
})
