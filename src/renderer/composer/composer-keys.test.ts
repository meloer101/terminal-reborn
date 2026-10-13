import { describe, expect, it } from 'vitest'
import { decideKey, isFocusShortcut, isImeEvent, type KeyAction, type KeyFacts } from './composer-keys'

function facts(key: string, extra: Partial<KeyFacts> = {}): KeyFacts {
  return {
    key,
    keyCode: 0,
    isComposing: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...extra
  }
}

const DEFAULT: KeyAction = { type: 'default' }
const SEND: KeyAction = { type: 'send' }
const SWALLOW: KeyAction = { type: 'swallow' }
const pt = (key: Extract<KeyAction, { type: 'passthrough' }>['key']): KeyAction => ({ type: 'passthrough', key })

describe('decideKey — Enter', () => {
  const cases: Array<[string, KeyFacts, string, KeyAction]> = [
    ['Enter with text sends', facts('Enter'), 'hello', SEND],
    ['⌘Enter with text sends', facts('Enter', { metaKey: true }), 'hello', SEND],
    ['⇧Enter inserts newline', facts('Enter', { shiftKey: true }), 'hello', DEFAULT],
    ['⇧Enter on empty input inserts newline', facts('Enter', { shiftKey: true }), '', DEFAULT],
    ['⌥Enter is left to the editor', facts('Enter', { altKey: true }), 'hello', DEFAULT],
    ['Enter on empty input is swallowed', facts('Enter'), '', SWALLOW],
    ['Enter on whitespace-only input is swallowed', facts('Enter'), ' \n ', SWALLOW],
    ['Enter sends multi-line text', facts('Enter'), 'a\nb', SEND]
  ]
  it.each(cases)('%s', (_name, f, text, expected) => {
    expect(decideKey(f, { text })).toEqual(expected)
  })
})

describe('decideKey — IME safety', () => {
  const ime: Array<[string, Partial<KeyFacts>]> = [
    ['isComposing', { isComposing: true }],
    ['keyCode 229', { keyCode: 229 }],
    ['key Process', { key: 'Process' }]
  ]
  for (const [name, extra] of ime) {
    it(`Enter never sends while ${name}`, () => {
      expect(decideKey(facts('Enter', extra), { text: 'ni hao' })).toEqual(DEFAULT)
      expect(decideKey(facts('Enter', extra), { text: '' })).toEqual(DEFAULT)
    })
  }
  it('pass-through keys are suppressed during composition', () => {
    for (const key of ['Escape', 'ArrowUp', 'ArrowDown']) {
      expect(decideKey(facts(key, { isComposing: true }), { text: '' })).toEqual(DEFAULT)
      expect(decideKey(facts(key, { keyCode: 229 }), { text: '' })).toEqual(DEFAULT)
    }
    expect(decideKey(facts('Tab', { shiftKey: true, isComposing: true }), { text: '' })).toEqual(DEFAULT)
  })
  it('isImeEvent covers all three signals', () => {
    expect(isImeEvent({ isComposing: true, keyCode: 13, key: 'Enter' })).toBe(true)
    expect(isImeEvent({ isComposing: false, keyCode: 229, key: 'Enter' })).toBe(true)
    expect(isImeEvent({ isComposing: false, keyCode: 13, key: 'Process' })).toBe(true)
    expect(isImeEvent({ isComposing: false, keyCode: 13, key: 'Enter' })).toBe(false)
  })
})

describe('decideKey — pass-through when empty', () => {
  const cases: Array<[string, KeyFacts, KeyAction]> = [
    ['Esc', facts('Escape'), pt('escape')],
    ['↑', facts('ArrowUp'), pt('up')],
    ['↓', facts('ArrowDown'), pt('down')],
    ['⇧Tab', facts('Tab', { shiftKey: true }), pt('shift-tab')],
    ['Ctrl+C', facts('c', { ctrlKey: true }), pt('ctrl-c')],
    ['Ctrl+C (uppercase key)', facts('C', { ctrlKey: true }), pt('ctrl-c')]
  ]
  it.each(cases)('%s is forwarded', (_name, f, expected) => {
    expect(decideKey(f, { text: '' })).toEqual(expected)
  })

  it('plain Tab, ⌘C, letters and modified arrows are not forwarded', () => {
    expect(decideKey(facts('Tab'), { text: '' })).toEqual(DEFAULT)
    expect(decideKey(facts('c', { metaKey: true }), { text: '' })).toEqual(DEFAULT)
    expect(decideKey(facts('a'), { text: '' })).toEqual(DEFAULT)
    expect(decideKey(facts('ArrowUp', { altKey: true }), { text: '' })).toEqual(DEFAULT)
    expect(decideKey(facts('ArrowDown', { shiftKey: true }), { text: '' })).toEqual(DEFAULT)
    expect(decideKey(facts('Escape', { shiftKey: true }), { text: '' })).toEqual(DEFAULT)
    expect(decideKey(facts('c', { ctrlKey: true, shiftKey: true }), { text: '' })).toEqual(DEFAULT)
  })
})

describe('decideKey — non-empty input keeps keys in the editor', () => {
  const keys: Array<[string, KeyFacts]> = [
    ['Esc', facts('Escape')],
    ['↑', facts('ArrowUp')],
    ['↓', facts('ArrowDown')],
    ['⇧Tab', facts('Tab', { shiftKey: true })],
    ['Ctrl+C', facts('c', { ctrlKey: true })]
  ]
  it.each(keys)('%s is never forwarded (Esc never clears a draft)', (_name, f) => {
    expect(decideKey(f, { text: 'draft' })).toEqual(DEFAULT)
  })
  it('a lone space counts as content, so arrows stay local', () => {
    expect(decideKey(facts('ArrowUp'), { text: ' ' })).toEqual(DEFAULT)
  })
})

describe('isFocusShortcut', () => {
  it('matches ⌘L only', () => {
    expect(isFocusShortcut(facts('l', { metaKey: true }))).toBe(true)
    expect(isFocusShortcut(facts('L', { metaKey: true }))).toBe(true)
    expect(isFocusShortcut(facts('l'))).toBe(false)
    expect(isFocusShortcut(facts('l', { metaKey: true, shiftKey: true }))).toBe(false)
    expect(isFocusShortcut(facts('l', { metaKey: true, altKey: true }))).toBe(false)
    expect(isFocusShortcut(facts('l', { ctrlKey: true }))).toBe(false)
  })
})
