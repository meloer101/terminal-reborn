import { describe, expect, it } from 'vitest'
import { parseGuiAnswer, parseGuiLaunch, parseGuiMessage, parseGuiSessionId, parseGuiText, parseGuiValue } from './validate'

describe('parseGuiLaunch', () => {
  it('accepts a launch and drops empty optional fields', () => {
    expect(parseGuiLaunch({ sessionId: 's-1', cwd: '/r', agent: 'claude', model: 'opus', initialPrompt: ' ', dispatched: false })).toEqual({ sessionId: 's-1', cwd: '/r', agent: 'claude', model: 'opus' })
    expect(parseGuiLaunch({ sessionId: 's', cwd: '/r', agent: 'grok', resumeAgentSessionId: 'abc', initialPrompt: 'go', dispatched: true })).toEqual({
      sessionId: 's',
      cwd: '/r',
      agent: 'grok',
      resumeAgentSessionId: 'abc',
      initialPrompt: 'go',
      dispatched: true
    })
  })

  it('takes a saved 权限 level and 计划 (Figma 56), nothing else', () => {
    expect(parseGuiLaunch({ sessionId: 's', cwd: '/r', agent: 'codex', permission: 'auto', plan: true })).toMatchObject({ permission: 'auto', plan: true })
    expect(parseGuiLaunch({ sessionId: 's', cwd: '/r', agent: 'codex', plan: false })).not.toHaveProperty('plan')
    expect(parseGuiLaunch({ sessionId: 's', cwd: '/r', agent: 'codex', permission: 'bypassPermissions' })).toBeNull()
    expect(parseGuiLaunch({ sessionId: 's', cwd: '/r', agent: 'codex', plan: 'on' })).toBeNull()
    // Main-only fields never come from a renderer.
    expect(parseGuiLaunch({ sessionId: 's', cwd: '/r', agent: 'claude', resumeAt: 'x' })).not.toHaveProperty('resumeAt')
  })

  it('refuses agents without a GUI, relative folders and bad ids', () => {
    expect(parseGuiLaunch({ sessionId: 's', cwd: '/r', agent: 'crush' })).toBeNull()
    expect(parseGuiLaunch({ sessionId: 's', cwd: '/r', agent: 'shell' })).toBeNull()
    expect(parseGuiLaunch({ sessionId: 's', cwd: 'r', agent: 'claude' })).toBeNull()
    expect(parseGuiLaunch({ sessionId: 's/x', cwd: '/r', agent: 'claude' })).toBeNull()
    expect(parseGuiLaunch({ sessionId: 's', cwd: '/r', agent: 'claude', resumeAgentSessionId: '../x' })).toBeNull()
    expect(parseGuiLaunch({ sessionId: 's', cwd: '/r', agent: 'claude', model: '--x' })).toBeNull()
    expect(parseGuiLaunch(null)).toBeNull()
  })
})

describe('parseGuiMessage', () => {
  it('needs text or an attachment; attachments are absolute paths', () => {
    expect(parseGuiMessage({ text: 'hi', attachments: ['/a.png'] })).toEqual({ text: 'hi', attachments: ['/a.png'] })
    expect(parseGuiMessage({ text: '', attachments: ['/a.png'] })).not.toBeNull()
    expect(parseGuiMessage({ text: '  ', attachments: [] })).toBeNull()
    expect(parseGuiMessage({ text: 'hi', attachments: ['a.png'] })).toBeNull()
    expect(parseGuiMessage({ text: 'hi', attachments: new Array(33).fill('/a') })).toBeNull()
    expect(parseGuiMessage({ text: 'x'.repeat(200_001), attachments: [] })).toBeNull()
  })
})

describe('parseGuiAnswer', () => {
  it('accepts the three kinds', () => {
    expect(parseGuiAnswer({ kind: 'permission', id: 'p', optionId: 'allow_once' })).toEqual({ kind: 'permission', id: 'p', optionId: 'allow_once' })
    expect(parseGuiAnswer({ kind: 'question', id: 'q', answers: { 'Which?': 'Blue' } })).toEqual({ kind: 'question', id: 'q', answers: { 'Which?': 'Blue' } })
    expect(parseGuiAnswer({ kind: 'plan', id: 'x', decision: 'approve-auto', message: 'ok' })).toEqual({ kind: 'plan', id: 'x', decision: 'approve-auto', message: 'ok' })
  })

  it('refuses unknown kinds and values', () => {
    expect(parseGuiAnswer({ kind: 'plan', id: 'x', decision: 'yolo' })).toBeNull()
    expect(parseGuiAnswer({ kind: 'question', id: 'q', answers: { a: 1 } })).toBeNull()
    expect(parseGuiAnswer({ kind: 'permission', id: '', optionId: 'a' })).toBeNull()
    expect(parseGuiAnswer({ kind: 'other', id: 'x' })).toBeNull()
  })
})

describe('small values', () => {
  it('session ids, picker values and queued text', () => {
    expect(parseGuiSessionId('a.b:c-d')).toBe('a.b:c-d')
    expect(parseGuiSessionId('')).toBeNull()
    expect(parseGuiValue('opus')).toBe('opus')
    expect(parseGuiValue('')).toBeNull()
    expect(parseGuiText('')).toBe('')
    expect(parseGuiText(3)).toBeNull()
  })
})
