import { describe, expect, it } from 'vitest'
import type { ChatItem } from '@shared/transcript-chat'
import { guiUserTexts, withAsked } from './asked'

const user = (id: string, text: string): ChatItem => ({ kind: 'user', id, at: 0, text, images: 0 })

describe('guiUserTexts', () => {
  it('lists what the user typed, oldest first, without Wavi\'s own messages and empty ones', () => {
    const items: ChatItem[] = [
      user('1', '加一个登录页'),
      { kind: 'system', id: 'a', at: 0, text: '好的' },
      user('2', '[Wavi 派活报告] x'),
      user('3', '   '),
      user('4', ' 再把按钮改成蓝色 ')
    ]
    expect(guiUserTexts(items)).toEqual(['加一个登录页', '再把按钮改成蓝色'])
  })

  it('is empty for a session without messages', () => {
    expect(guiUserTexts([])).toEqual([])
  })
})

describe('withAsked', () => {
  const req = { root: '/w', agent: 'claude', trigger: 'manual' } as const
  it('adds asked only when there is something to show', () => {
    expect(withAsked(req, ['a'])).toEqual({ ...req, asked: ['a'] })
    expect(withAsked(req, [])).toEqual(req)
  })
})
