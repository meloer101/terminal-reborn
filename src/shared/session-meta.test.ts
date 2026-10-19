import { describe, expect, it } from 'vitest'
import {
  codexContextPercent,
  contextDetail,
  formatReset,
  formatTokens,
  formatUpdated,
  lastCodexTokenCount,
  orderVendors,
  parseClaudeStatusLine,
  parseCodexTokenCount,
  sameUsage,
  topWindow,
  windowLabel,
  windowShort,
  type VendorUsage
} from './session-meta'

const AT = 1_792_413_000_000

// Claude Code 2.1.301 statusLine payload (PRD §6.6), trimmed.
const STATUSLINE = {
  session_id: 'f72689a2',
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  context_window: {
    total_input_tokens: 51725,
    context_window_size: 200000,
    current_usage: { input_tokens: 2, output_tokens: 4, cache_creation_input_tokens: 25882, cache_read_input_tokens: 146116 },
    used_percentage: 86,
    remaining_percentage: 14
  },
  rate_limits: {
    five_hour: { used_percentage: 13, resets_at: 1792191000 },
    seven_day: { used_percentage: 26.4, resets_at: 1792461600 }
  }
}

// Codex 0.142.5 rollout `token_count` with plan headers (scripts/spikes/42-codex-usage-lab.mjs).
const TOKEN_COUNT = {
  type: 'token_count',
  info: {
    total_token_usage: { input_tokens: 110000, output_tokens: 5, total_tokens: 110005 },
    last_token_usage: { input_tokens: 100000, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 100005 },
    model_context_window: 258400
  },
  rate_limits: {
    limit_id: 'codex',
    primary: { used_percent: 40.5, window_minutes: 300, resets_at: 1792420883 },
    secondary: { used_percent: 12, window_minutes: 10080, resets_at: 1792766483 },
    credits: null
  }
}

describe('parseClaudeStatusLine', () => {
  it('reads the context window and both plan windows', () => {
    expect(parseClaudeStatusLine(STATUSLINE, AT)).toEqual({
      context: { percent: 86, usedTokens: 172000, windowTokens: 200000 },
      usage: {
        vendor: 'claude',
        at: AT,
        windows: [
          { minutes: 300, percent: 13, resetsAt: 1792191000_000 },
          { minutes: 10080, percent: 26, resetsAt: 1792461600_000 }
        ]
      }
    })
  })

  it('has nothing before the first response (null percentage, no rate_limits)', () => {
    expect(parseClaudeStatusLine({ context_window: { used_percentage: null, current_usage: null, context_window_size: 200000 } }, AT)).toEqual({})
    expect(parseClaudeStatusLine('nope', AT)).toEqual({})
  })

  it('estimates tokens from the percentage when current_usage is missing, and drops bad reset times', () => {
    const reading = parseClaudeStatusLine(
      { context_window: { used_percentage: 50, context_window_size: 1_000_000 }, rate_limits: { five_hour: { used_percentage: 3, resets_at: 'soon' } } },
      AT
    )
    expect(reading.context).toEqual({ percent: 50, usedTokens: 500000, windowTokens: 1000000 })
    expect(reading.usage?.windows).toEqual([{ minutes: 300, percent: 3 }])
  })
})

describe('Codex rollout', () => {
  it('reads context and plan windows from token_count', () => {
    expect(parseCodexTokenCount(TOKEN_COUNT, AT)).toEqual({
      context: { percent: codexContextPercent(100005, 258400), usedTokens: 100005, windowTokens: 258400 },
      usage: {
        vendor: 'codex',
        at: AT,
        windows: [
          { minutes: 300, percent: 41, resetsAt: 1792420883_000 },
          { minutes: 10080, percent: 12, resetsAt: 1792766483_000 }
        ]
      }
    })
  })

  it('leaves usage out without plan headers and context out before the first response', () => {
    const noLimits = { ...TOKEN_COUNT, rate_limits: { limit_id: 'codex', primary: null, secondary: null } }
    expect(parseCodexTokenCount(noLimits, AT).usage).toBeUndefined()
    expect(parseCodexTokenCount({ ...TOKEN_COUNT, info: null }, AT).context).toBeUndefined()
    expect(parseCodexTokenCount({ type: 'agent_message' }, AT)).toEqual({})
  })

  it('matches Codex’s own context figure (12k baseline)', () => {
    expect(codexContextPercent(12_000, 258_400)).toBe(0)
    expect(codexContextPercent(258_400, 258_400)).toBe(100)
    expect(codexContextPercent(135_200, 258_400)).toBe(50)
    expect(codexContextPercent(5, 10_000)).toBe(100)
  })

  it('takes the newest token_count of a tail, skipping torn and unrelated lines', () => {
    const older = { ...TOKEN_COUNT, rate_limits: { ...TOKEN_COUNT.rate_limits, primary: { used_percent: 10, window_minutes: 300 } } }
    const tail = [
      '{"type":"event_msg","payload":' + JSON.stringify(older) + '}',
      '{"type":"event_msg","payload":' + JSON.stringify(TOKEN_COUNT) + '}',
      '{"type":"response_item","payload":{"type":"message"}}',
      '{"type":"event_msg","payload":{"type":"token_count","in'
    ].join('\n')
    expect(lastCodexTokenCount(tail, AT).usage?.windows[0]?.percent).toBe(41)
    expect(lastCodexTokenCount('', AT)).toEqual({})
  })
})

describe('usage selection', () => {
  const claude: VendorUsage = {
    vendor: 'claude',
    at: AT,
    windows: [
      { minutes: 300, percent: 13, resetsAt: AT + 3_600_000 },
      { minutes: 10080, percent: 84, resetsAt: AT + 86_400_000 }
    ]
  }
  const codex: VendorUsage = { vendor: 'codex', at: AT, windows: [{ minutes: 300, percent: 40, resetsAt: AT + 60_000 }] }

  it('shows the most used window, ignoring windows that already reset', () => {
    expect(topWindow(claude, AT)?.minutes).toBe(10080)
    expect(topWindow(claude, AT + 2 * 86_400_000)).toBeNull()
    expect(topWindow({ ...claude, windows: [{ minutes: 300, percent: 5 }] }, AT)?.percent).toBe(5)
  })

  it('lists the current vendor first and drops vendors with nothing live', () => {
    expect(orderVendors([claude, codex], 'codex', AT).map((u) => u.vendor)).toEqual(['codex', 'claude'])
    expect(orderVendors([codex, claude], null, AT).map((u) => u.vendor)).toEqual(['claude', 'codex'])
    expect(orderVendors([claude, codex], 'claude', AT + 120_000).map((u) => u.vendor)).toEqual(['claude'])
  })

  it('compares readings by figures only', () => {
    expect(sameUsage(claude, { ...claude, at: AT + 5 })).toBe(true)
    expect(sameUsage(claude, codex)).toBe(false)
    expect(sameUsage(undefined, undefined)).toBe(true)
  })
})

describe('formatting', () => {
  it('names windows', () => {
    expect(windowShort(300)).toBe('5h')
    expect(windowShort(10080)).toBe('7d')
    expect(windowLabel('claude', 300)).toBe('5 小时')
    expect(windowLabel('claude', 10080)).toBe('7 天')
    expect(windowLabel('codex', 10080)).toBe('每周')
  })

  it('formats reset times, update age and token counts', () => {
    const now = new Date(2026, 9, 19, 14, 0).getTime()
    expect(formatReset(new Date(2026, 9, 19, 18, 30).getTime(), now)).toBe('18:30 重置')
    expect(formatReset(new Date(2026, 9, 20, 9, 0).getTime(), now)).toBe('10 月 20 日重置')
    expect(formatUpdated(now - 20_000, now)).toBe('刚刚更新')
    expect(formatUpdated(now - 65_000, now)).toBe('1 分钟前更新')
    expect(formatUpdated(now - 3 * 3_600_000, now)).toBe('3 小时前更新')
    expect(formatTokens(172_000)).toBe('172k')
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(850)).toBe('850')
    expect(contextDetail({ percent: 86, usedTokens: 172_000, windowTokens: 200_000 })).toBe('context 172k / 200k · 86%')
    expect(contextDetail({ percent: 5 })).toBe('context 5%')
  })
})
