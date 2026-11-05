import { describe, expect, it } from 'vitest'
import { currentBranch, resumePointOf } from './claude-rewind'

const user = (uuid: string, parentUuid: string | null, content: unknown = 'hi') => ({ type: 'user', uuid, parentUuid, message: { role: 'user', content } })
const assistant = (uuid: string, parentUuid: string) => ({ type: 'assistant', uuid, parentUuid, message: { content: [{ type: 'text', text: 'OK' }] } })
const attachment = (uuid: string, parentUuid: string) => ({ type: 'attachment', uuid, parentUuid })

// What Claude 2.1.318 wrote in the spike: APPLE, BANANA, then a resume at the reply to APPLE and a new prompt.
const rows = [
  user('u1', null),
  attachment('a1', 'u1'),
  assistant('r1', 'a1'),
  attachment('a2', 'r1'),
  user('u2', 'a2'),
  attachment('a3', 'u2'),
  assistant('r2', 'a3'),
  { type: 'queue-operation' },
  user('u3', 'r1'),
  assistant('r3', 'u3')
]

describe('currentBranch', () => {
  it('leaves out what an edit cut: the earlier child of the resumed message and what hangs under it', () => {
    expect(currentBranch(rows)).toEqual([true, true, true, false, false, false, false, true, true, true])
  })

  it('keeps a straight conversation, and a tool result that shares a parent with nothing', () => {
    const straight = [user('u1', null), assistant('r1', 'u1'), user('t1', 'r1', [{ type: 'tool_result', content: 'x' }]), assistant('r2', 't1')]
    expect(currentBranch(straight)).toEqual([true, true, true, true])
  })

  it('does not take a second tool result under one message for an edit', () => {
    const two = [user('u1', null), assistant('r1', 'u1'), user('t1', 'r1', [{ type: 'tool_result' }]), user('t2', 'r1', [{ type: 'tool_result' }])]
    expect(currentBranch(two)).toEqual([true, true, true, true])
  })

  it('follows a second edit of the same message', () => {
    const again = [...rows, user('u4', 'r1'), assistant('r4', 'u4')]
    expect(currentBranch(again).slice(8)).toEqual([false, false, true, true])
  })
})

describe('resumePointOf', () => {
  it('is the last message before the prompt on its branch', () => {
    expect(resumePointOf(rows, 'u3')).toBe('r1')
    expect(resumePointOf(rows.slice(0, 7), 'u2')).toBe('r1')
  })

  it('is null for the first prompt, undefined for a cut, unknown or non-prompt line', () => {
    expect(resumePointOf(rows, 'u1')).toBeNull()
    expect(resumePointOf(rows, 'u2')).toBeUndefined()
    expect(resumePointOf(rows, 'r1')).toBeUndefined()
    expect(resumePointOf(rows, 'nope')).toBeUndefined()
  })

  it('is undefined, not a new conversation, when the chain runs into lines that were not read', () => {
    // The newest part of a long transcript: u3's parent r1 is in the part not read.
    expect(resumePointOf([user('u3', 'r1'), assistant('r3', 'u3')], 'u3')).toBeUndefined()
  })
})
