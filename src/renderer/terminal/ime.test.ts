import { describe, expect, it } from 'vitest'
import { AUTO_PERIOD_WINDOW_MS, isAutoPeriod, type TextInsertion } from './ime'

const insertion = (facts: Partial<TextInsertion> = {}): TextInsertion => ({
  inputType: 'insertText',
  data: '. ',
  keyHeld: false,
  lastInput: '아 ',
  msSinceLastInput: 149,
  ...facts
})

describe('isAutoPeriod', () => {
  it('drops the ". " the input method adds after a typed space (orca#11504)', () => {
    expect(isAutoPeriod(insertion())).toBe(true)
    expect(isAutoPeriod(insertion({ lastInput: ' ' }))).toBe(true)
    expect(isAutoPeriod(insertion({ inputType: 'insertReplacementText', msSinceLastInput: AUTO_PERIOD_WINDOW_MS }))).toBe(true)
  })

  it('keeps anything typed, composed or not right after a space', () => {
    expect(isAutoPeriod(insertion({ keyHeld: true }))).toBe(false)
    expect(isAutoPeriod(insertion({ inputType: 'insertCompositionText' }))).toBe(false)
    expect(isAutoPeriod(insertion({ data: '.' }))).toBe(false)
    expect(isAutoPeriod(insertion({ data: '。' }))).toBe(false)
    expect(isAutoPeriod(insertion({ data: null }))).toBe(false)
    expect(isAutoPeriod(insertion({ lastInput: '아' }))).toBe(false)
    expect(isAutoPeriod(insertion({ lastInput: '' }))).toBe(false)
    expect(isAutoPeriod(insertion({ msSinceLastInput: AUTO_PERIOD_WINDOW_MS + 1 }))).toBe(false)
    expect(isAutoPeriod(insertion({ inputType: 'deleteContentBackward' }))).toBe(false)
  })
})
