import { describe, expect, it } from 'vitest'
import { greeting, greetingFor, INSTALLABLE_AGENTS, needsAgentInstall, pickQuote, QUOTES } from './empty-main'

describe('greetingFor', () => {
  it('follows the time of day, wrapping past midnight', () => {
    expect([5, 10, 11, 12, 13, 17, 18, 22, 23, 0, 4].map(greetingFor)).toEqual([
      '早上好',
      '早上好',
      '中午好',
      '中午好',
      '下午好',
      '下午好',
      '晚上好',
      '晚上好',
      '夜深了',
      '夜深了',
      '夜深了'
    ])
  })
})

describe('greeting', () => {
  it('adds the name after a full-width comma, or leaves it out', () => {
    expect(greeting(14, 'Jacoy')).toBe('下午好，Jacoy')
    expect(greeting(14, '')).toBe('下午好')
  })
})

describe('pickQuote', () => {
  it('maps the whole random range onto the list', () => {
    expect(pickQuote(() => 0)).toBe(QUOTES[0])
    expect(pickQuote(() => 0.999999)).toBe(QUOTES[QUOTES.length - 1])
    expect(pickQuote(() => 1)).toBe(QUOTES[QUOTES.length - 1])
  })

  it('attributed lines carry no closing 。', () => {
    for (const q of QUOTES.filter((x) => x.by)) expect(q.text.endsWith('。')).toBe(false)
  })
})

describe('needsAgentInstall', () => {
  it('only once detection finished and neither agent is installed', () => {
    expect(needsAgentInstall(null)).toBe(false)
    expect(needsAgentInstall({ claude: false, codex: false })).toBe(true)
    expect(needsAgentInstall({ claude: true, codex: false })).toBe(false)
    expect(needsAgentInstall({ claude: false, codex: true })).toBe(false)
  })

  it('offers Claude Code first, every agent with a command', () => {
    expect(INSTALLABLE_AGENTS[0]?.id).toBe('claude')
    for (const a of INSTALLABLE_AGENTS) expect(a.command.length).toBeGreaterThan(0)
  })
})
