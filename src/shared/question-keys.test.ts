import { describe, expect, it } from 'vitest'
import type { AgentQuestion } from './agent-events'
import {
  GROUP_GAP_MS,
  KEY_DOWN,
  KEY_ENTER,
  KEY_GAP_MS,
  KEY_RIGHT,
  cleanOtherText,
  planQuestionAnswer
} from './question-keys'
import type { SendStep } from './send-protocol'

const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `opt${i + 1}` }))
const single = (n = 3): AgentQuestion => ({ question: 'q', multiSelect: false, options: opts(n) })
const multi = (n = 4): AgentQuestion => ({ question: 'q', multiSelect: true, options: opts(n) })

/** Compact, readable form of a plan: writes as their text, delays as `~ms`, waits as `wait(needle)`. */
function show(steps: SendStep[]): string[] {
  const names: Record<string, string> = { [KEY_ENTER]: '<Enter>', [KEY_DOWN]: '<Down>', [KEY_RIGHT]: '<Right>', '\x1b[A': '<Up>' }
  return steps.map((s) => {
    if (s.type === 'write') return names[s.data] ?? s.data
    if (s.type === 'delay') return `~${s.ms}`
    return `wait(${s.needles.join('|')})`
  })
}

describe('planQuestionAnswer · single', () => {
  it.each([
    [0, '1'],
    [1, '2'],
    [2, '3']
  ])('option %i is its digit and nothing else (one question submits by itself)', (index, digit) => {
    expect(show(planQuestionAnswer(single(), { kind: 'single', index }))).toEqual([digit])
  })

  it('several questions: only the last one adds the review confirmation', () => {
    expect(show(planQuestionAnswer(single(), { kind: 'single', index: 1 }, { index: 0, total: 2 }))).toEqual(['2'])
    expect(show(planQuestionAnswer(single(), { kind: 'single', index: 1 }, { index: 1, total: 2 }))).toEqual([
      `~${GROUP_GAP_MS}`,
      '2',
      `~${GROUP_GAP_MS}`,
      '<Enter>'
    ])
  })

  it('options past the ninth are reached with the arrow keys', () => {
    const steps = show(planQuestionAnswer(single(12), { kind: 'single', index: 9 }))
    expect(steps).toEqual([...Array<string>(9).fill('<Down>'), '<Enter>'])
  })

  it('rejects an out-of-range index and the wrong selection kind', () => {
    expect(() => planQuestionAnswer(single(), { kind: 'single', index: 3 })).toThrow()
    expect(() => planQuestionAnswer(single(), { kind: 'single', index: -1 })).toThrow()
    expect(() => planQuestionAnswer(single(), { kind: 'multi', indices: [0] })).toThrow()
  })
})

describe('planQuestionAnswer · other', () => {
  it('N+1, pause, text, wait for the echo, Enter', () => {
    const steps = planQuestionAnswer(single(3), { kind: 'other', text: 'teal blue' })
    expect(show(steps)).toEqual(['4', `~${GROUP_GAP_MS}`, 'teal blue', 'wait(teal blue)', `~${KEY_GAP_MS}`, '<Enter>'])
  })

  it('CJK text, multi-line text is flattened, echo needle is a short prefix', () => {
    const steps = planQuestionAnswer(single(2), { kind: 'other', text: '  换成\n另一个方案，谢谢你们大家一起帮忙  ' })
    const text = steps.find((s): s is Extract<SendStep, { type: 'write' }> => s.type === 'write' && s.data.includes('换成'))
    expect(text?.data).toBe('换成 另一个方案，谢谢你们大家一起帮忙')
    const wait = steps.find((s): s is Extract<SendStep, { type: 'waitForText' }> => s.type === 'waitForText')
    expect(wait?.needles).toEqual(['换成 另一个方案，谢谢你'])
    expect(wait?.timeoutMs).toBeGreaterThan(0)
  })

  it('appends the review confirmation on the last of several questions', () => {
    const steps = show(planQuestionAnswer(single(2), { kind: 'other', text: 'x' }, { index: 1, total: 2 }))
    expect(steps.at(-1)).toBe('<Enter>')
    expect(steps.at(-2)).toBe(`~${GROUP_GAP_MS}`)
    expect(steps.slice(0, 2)).toEqual([`~${GROUP_GAP_MS}`, '3'])
  })

  it('rejects empty text', () => {
    expect(() => planQuestionAnswer(single(), { kind: 'other', text: ' \n ' })).toThrow()
  })
})

describe('planQuestionAnswer · multi', () => {
  it('digits toggle, then → leaves the question, then Enter confirms the review (single question)', () => {
    expect(show(planQuestionAnswer(multi(), { kind: 'multi', indices: [1, 3] }))).toEqual([
      '2',
      `~${KEY_GAP_MS}`,
      '4',
      `~${GROUP_GAP_MS}`,
      '<Right>',
      `~${GROUP_GAP_MS}`,
      '<Enter>'
    ])
  })

  it('sorts and de-duplicates the ticks', () => {
    const steps = show(planQuestionAnswer(multi(), { kind: 'multi', indices: [3, 1, 3] }))
    expect(steps.slice(0, 3)).toEqual(['2', `~${KEY_GAP_MS}`, '4'])
  })

  it('not the last question: no review confirmation', () => {
    const steps = show(planQuestionAnswer(multi(), { kind: 'multi', indices: [0] }, { index: 0, total: 2 }))
    expect(steps).toEqual(['1', `~${GROUP_GAP_MS}`, '<Right>'])
  })

  it('a later question waits for the tab switch first', () => {
    const steps = show(planQuestionAnswer(multi(), { kind: 'multi', indices: [0] }, { index: 1, total: 3 }))
    expect(steps).toEqual([`~${GROUP_GAP_MS}`, '1', `~${GROUP_GAP_MS}`, '<Right>'])
  })

  it('free text: cursor to the "Type something" row, type, ↓ to Submit, Enter', () => {
    const steps = show(planQuestionAnswer(multi(4), { kind: 'multi', indices: [0], other: 'kiwi' }))
    expect(steps).toEqual([
      '1',
      `~${GROUP_GAP_MS}`,
      '<Down>',
      '<Down>',
      '<Down>',
      '<Down>',
      'kiwi',
      'wait(kiwi)',
      `~${KEY_GAP_MS}`,
      '<Down>',
      `~${KEY_GAP_MS}`,
      '<Enter>',
      `~${GROUP_GAP_MS}`,
      '<Enter>'
    ])
  })

  it('free text only (nothing ticked) starts straight with the arrows', () => {
    const steps = show(planQuestionAnswer(multi(2), { kind: 'multi', indices: [], other: 'x' }, { index: 0, total: 2 }))
    expect(steps).toEqual(['<Down>', '<Down>', 'x', 'wait(x)', `~${KEY_GAP_MS}`, '<Down>', `~${KEY_GAP_MS}`, '<Enter>'])
  })

  it('nothing ticked and no text is just →', () => {
    expect(show(planQuestionAnswer(multi(), { kind: 'multi', indices: [] }, { index: 0, total: 2 }))).toEqual(['<Right>'])
  })

  it('rows past the ninth are toggled with arrows + Enter', () => {
    const steps = show(planQuestionAnswer(multi(11), { kind: 'multi', indices: [0, 9] }, { index: 0, total: 2 }))
    expect(steps).toEqual(['1', `~${KEY_GAP_MS}`, ...Array<string>(9).fill('<Down>'), '<Enter>', `~${GROUP_GAP_MS}`, '<Right>'])
  })

  it('rejects bad selections', () => {
    expect(() => planQuestionAnswer(multi(), { kind: 'multi', indices: [4] })).toThrow()
    expect(() => planQuestionAnswer(multi(), { kind: 'multi', indices: [], other: '  ' })).toThrow()
    expect(() => planQuestionAnswer(multi(), { kind: 'single', index: 0 })).toThrow()
  })
})

describe('cleanOtherText', () => {
  it('keeps one line, drops control characters', () => {
    expect(cleanOtherText('a\r\nb\tc\u001b[A')).toBe('a b c[A')
  })
})
