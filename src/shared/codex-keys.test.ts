import { describe, expect, it } from 'vitest'
import type { AgentQuestion } from './agent-events'
import { CODEX_KEY_CANCEL, CODEX_KEY_YES, detectCodexApproval, planCodexApproval, planCodexQuestionAnswer } from './codex-keys'
import { GROUP_GAP_MS } from './question-keys'

const question = (n: number): AgentQuestion => ({
  question: 'Which?',
  multiSelect: false,
  options: Array.from({ length: n }, (_, i) => ({ label: `o${i + 1}` }))
})

describe('planCodexApproval', () => {
  it('allow-once is y', () => {
    expect(planCodexApproval('allow-once')).toEqual([{ type: 'write', data: CODEX_KEY_YES }])
  })

  it('deny is Esc (cancels the request and interrupts the turn)', () => {
    expect(planCodexApproval('deny')).toEqual([{ type: 'write', data: CODEX_KEY_CANCEL }])
  })

  it('allow-always never presses the "don\'t ask again" row (it would write ~/.codex rules)', () => {
    expect(planCodexApproval('allow-always')).toEqual(planCodexApproval('allow-once'))
  })
})

describe('detectCodexApproval', () => {
  const command = [
    '  Would you like to run the following command?',
    '',
    '  $ echo codex-lab-ran > /tmp/x',
    '',
    '› 1. Yes, proceed (y)',
    "  2. Yes, and don't ask again for commands that start with `echo` (p)",
    '  3. No, and tell Codex what to do differently (esc)'
  ].join('\n')

  it('recognises the command and edit dialogs', () => {
    expect(detectCodexApproval(command)).toBe('command')
    expect(detectCodexApproval(command.replace('run the following command', 'make the following edits'))).toBe('edit')
  })

  it('needs the options too, so scrollback of an old question text does not count', () => {
    expect(detectCodexApproval('Would you like to run the following command?')).toBeNull()
    expect(detectCodexApproval('› Reply with only the word OK.')).toBeNull()
  })
})

describe('planCodexQuestionAnswer', () => {
  it('a single digit selects and submits; the first question needs no pause', () => {
    expect(planCodexQuestionAnswer(question(2), { kind: 'single', index: 1 })).toEqual([{ type: 'write', data: '2' }])
  })

  it('later questions wait for the tab switch and there is no review screen to confirm', () => {
    expect(planCodexQuestionAnswer(question(3), { kind: 'single', index: 2 }, { index: 1, total: 2 })).toEqual([
      { type: 'delay', ms: GROUP_GAP_MS },
      { type: 'write', data: '3' }
    ])
  })

  it('free text picks "None of the above" (row N+1)', () => {
    expect(planCodexQuestionAnswer(question(2), { kind: 'other', text: 'whatever' })).toEqual([{ type: 'write', data: '3' }])
  })

  it('rejects what the menu cannot do', () => {
    expect(() => planCodexQuestionAnswer(question(2), { kind: 'single', index: 2 })).toThrow('out of range')
    expect(() => planCodexQuestionAnswer(question(2), { kind: 'multi', indices: [0] })).toThrow('single-select')
    expect(() => planCodexQuestionAnswer(question(9), { kind: 'other', text: 'x' })).toThrow('digit')
  })
})
