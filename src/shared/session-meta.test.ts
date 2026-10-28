import { describe, expect, it } from 'vitest'
import {
  orderByTightest,
  paceBar,
  planLabel,
  vendorStatus,
  autoCompactRuleFromEnv,
  claudeCompactAt,
  codexCompactAt,
  codexContextPercent,
  contextDetail,
  contextHigh,
  contextMark,
  contextProjection,
  contextSegments,
  formatClock,
  formatDuration,
  formatUpdatedNote,
  formatUsd,
  paceNote,
  sameContext,
  shareRows,
  shareWindow,
  sparkline,
  usageAlertLevel,
  usageAlertText,
  usageChipText,
  windowPace,
  formatReset,
  formatTokens,
  formatUpdated,
  lastCodexTokenCount,
  orderVendors,
  parseClaudeAccountUsage,
  parseClaudeStatusLine,
  parseCodexAccountRateLimits,
  parseCodexTokenCount,
  sameUsage,
  topWindow,
  windowKey,
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
      context: {
        percent: 86,
        usedTokens: 172000,
        windowTokens: 200000,
        cacheRead: 146116,
        cacheWrite: 25882,
        freshInput: 2,
        model: 'Opus 5.5',
        // Claude Code 2.1.304 compacts at 200k − 20k − 13k.
        compactAt: 167000,
        compactPercent: 84
      },
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

  it('says "unknown" before the first response and after /compact (null percentage and usage), nothing for junk', () => {
    expect(parseClaudeStatusLine({ context_window: { used_percentage: null, current_usage: null, context_window_size: 200000 } }, AT)).toEqual({ context: null })
    expect(parseClaudeStatusLine({ context_window: { context_window_size: 200000 } }, AT)).toEqual({})
    expect(parseClaudeStatusLine('nope', AT)).toEqual({})
  })

  it('places the compaction point by the launch environment', () => {
    expect(claudeCompactAt(200_000)).toBe(167_000)
    expect(claudeCompactAt(1_000_000)).toBe(967_000)
    expect(claudeCompactAt(1_000_000, autoCompactRuleFromEnv({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '400k' }))).toBe(367_000)
    expect(claudeCompactAt(200_000, autoCompactRuleFromEnv({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '50' }))).toBe(90_000)
    expect(claudeCompactAt(200_000, autoCompactRuleFromEnv({ DISABLE_AUTO_COMPACT: '1' }))).toBeNull()
    expect(claudeCompactAt(undefined)).toBeNull()
    expect(autoCompactRuleFromEnv({ DISABLE_COMPACT: 'false', CLAUDE_CODE_AUTO_COMPACT_WINDOW: 'lots' })).toEqual({ enabled: true })
    const off = parseClaudeStatusLine(STATUSLINE, AT, { enabled: false }).context
    expect(off?.compactAt).toBeUndefined()
  })

  it('estimates tokens from the percentage when current_usage is missing, and drops bad reset times', () => {
    const reading = parseClaudeStatusLine(
      { context_window: { used_percentage: 50, context_window_size: 1_000_000 }, rate_limits: { five_hour: { used_percentage: 3, resets_at: 'soon' } } },
      AT
    )
    expect(reading.context).toEqual({ percent: 50, usedTokens: 500000, windowTokens: 1000000, compactAt: 967000, compactPercent: 97 })
    expect(reading.usage?.windows).toEqual([{ minutes: 300, percent: 3 }])
  })
})

describe('Codex rollout', () => {
  it('reads context and plan windows from token_count', () => {
    expect(parseCodexTokenCount(TOKEN_COUNT, AT)).toEqual({
      context: {
        percent: codexContextPercent(100005, 258400),
        usedTokens: 100005,
        windowTokens: 258400,
        cacheRead: 0,
        freshInput: 100000,
        outputTotal: 5,
        // 90 % of the 272k model window, i.e. 94 % on Codex's own scale.
        compactAt: 244800,
        compactPercent: 94
      },
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

  it('counts only the plan’s own bucket, not a model-specific one', () => {
    const spark = { ...TOKEN_COUNT, rate_limits: { ...TOKEN_COUNT.rate_limits, limit_id: 'codex_bengalfox' } }
    expect(parseCodexTokenCount(spark, AT).usage).toBeUndefined()
    expect(codexCompactAt(258_400)).toBe(244_800)
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

describe('Figma 18 · context details', () => {
  it('reads cost, output and the prompt cache from the Claude statusLine', () => {
    const reading = parseClaudeStatusLine(
      {
        ...STATUSLINE,
        context_window: { ...STATUSLINE.context_window, total_output_tokens: 38_000 },
        cost: { total_cost_usd: 3.4217 },
        prompt_cache: { warm: true, expires_at: 1792413240 }
      },
      AT
    )
    expect(reading.context).toMatchObject({ outputTotal: 38_000, costUsd: 3.4217, cacheWarm: true, cacheExpiresAt: 1792413240_000 })
    const cold = parseClaudeStatusLine({ ...STATUSLINE, prompt_cache: { warm: false, expires_at: 1792413240 }, cost: { total_cost_usd: -1 } }, AT)
    expect(cold.context?.cacheWarm).toBe(false)
    expect(cold.context?.cacheExpiresAt).toBeUndefined()
    expect(cold.context?.costUsd).toBeUndefined()
  })

  it('compares every figure, not only the percentage', () => {
    expect(sameContext({ percent: 5, costUsd: 1 }, { percent: 5, costUsd: 1 })).toBe(true)
    expect(sameContext({ percent: 5, costUsd: 1 }, { percent: 5, costUsd: 1.5 })).toBe(false)
    expect(sameContext(undefined, undefined)).toBe(true)
    expect(sameContext({ percent: 5 }, undefined)).toBe(false)
  })
})

describe('the accounts asked directly', () => {
  it('reads Codex’s account/rateLimits/read, preferring the codex bucket', () => {
    const result = {
      rateLimits: { limitId: 'codex_bengalfox', primary: { usedPercent: 90, windowDurationMins: 300, resetsAt: 1792420883 } },
      rateLimitsByLimitId: {
        codex: {
          limitId: 'codex',
          primary: { usedPercent: 41, windowDurationMins: 300, resetsAt: 1792420883 },
          secondary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: 1792766483 }
        }
      }
    }
    expect(parseCodexAccountRateLimits(result, AT)).toEqual({
      vendor: 'codex',
      at: AT,
      complete: true,
      windows: [
        { minutes: 300, percent: 41, resetsAt: 1792420883_000 },
        { minutes: 10080, percent: 12, resetsAt: 1792766483_000 }
      ]
    })
    // An older Codex has only the single-bucket view; a foreign bucket alone says nothing about the plan.
    expect(parseCodexAccountRateLimits({ rateLimits: result.rateLimitsByLimitId.codex }, AT)?.windows).toHaveLength(2)
    expect(parseCodexAccountRateLimits({ rateLimits: result.rateLimits }, AT)).toBeNull()
    expect(parseCodexAccountRateLimits('nope', AT)).toBeNull()
  })

  it('reads Claude’s get_usage: limits[] with model-scoped weeks, else the named windows', () => {
    // Claude Code 2.1.304 get_usage answer (Max plan, PRD §6.6), trimmed.
    const answer = {
      subscription_type: 'max',
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 20, resets_at: '2026-10-20T07:39:59.742399+00:00' },
        seven_day: { utilization: 3, resets_at: '2026-10-27T01:59:59.742421+00:00' },
        seven_day_sonnet: null,
        limits: [
          { kind: 'session', group: 'session', percent: 20, resets_at: '2026-10-20T07:39:59.742399+00:00', scope: null },
          { kind: 'weekly_all', group: 'weekly', percent: 3, resets_at: '2026-10-27T01:59:59.742421+00:00', scope: null },
          { kind: 'weekly_scoped', group: 'weekly', percent: 41, resets_at: '2026-10-27T02:00:00+00:00', scope: { model: { display_name: 'Fable' } } },
          { kind: 'weekly_scoped', group: 'weekly', percent: 0, resets_at: '2026-10-27T02:00:00+00:00', scope: { model: { display_name: 'Opus' } } },
          { kind: 'something_new', group: 'monthly', percent: 5 }
        ]
      }
    }
    expect(parseClaudeAccountUsage(answer, AT)).toEqual({
      vendor: 'claude',
      at: AT,
      complete: true,
      windows: [
        { minutes: 300, percent: 20, resetsAt: Date.parse('2026-10-20T07:39:59.742Z') },
        { minutes: 10080, percent: 3, resetsAt: Date.parse('2026-10-27T01:59:59.742Z') },
        { minutes: 10080, scope: 'Fable', percent: 41, resetsAt: Date.parse('2026-10-27T02:00:00Z') }
      ]
    })
    const older = { rate_limits: { five_hour: { utilization: 7, resets_at: '2026-10-20T07:39:59Z' }, seven_day_sonnet: { utilization: 30, resets_at: '2026-10-27T02:00:00Z' } } }
    expect(parseClaudeAccountUsage(older, AT)?.windows.map(windowKey)).toEqual(['300', '10080:Sonnet'])
    expect(parseClaudeAccountUsage({ rate_limits: null }, AT)).toBeNull()
  })

  it('names scoped windows', () => {
    expect(windowLabel('claude', 10080, 'Sonnet')).toBe('7 天 · Sonnet')
    expect(usageChipText({ minutes: 10080, scope: 'Sonnet', percent: 84 }, AT)).toBe('7d Sonnet 84%')
    expect(usageAlertText({ vendor: 'claude', minutes: 10080, scope: 'Fable', percent: 90, level: 90 }, AT).title).toBe('Claude 7 天 · Fable 额度已用 90%')
  })
})

describe('context near its compaction', () => {
  it('is high where the agent starts warning (20k before it compacts), else at 80 %', () => {
    const at = (usedTokens: number) => ({ percent: Math.round(usedTokens / 2000), usedTokens, windowTokens: 200_000, compactAt: 167_000, compactPercent: 84 })
    expect(contextHigh(at(146_000))).toBe(false)
    expect(contextHigh(at(147_000))).toBe(true)
    expect(contextHigh({ percent: 80 })).toBe(true)
    expect(contextMark(at(1))).toBe(84)
    expect(contextMark({})).toBe(80)
  })

  it('projects to the compaction point when it is known', () => {
    expect(contextProjection([40, 50, 60, 70], { compactPercent: 84 })).toBe('按最近 3 轮的增速，大约 1–2 轮后自动压缩')
    expect(contextProjection([70, 80, 90], { compactPercent: 84 })).toBeNull()
  })
})

describe('Figma 18 · plan window pace', () => {
  const HOUR = 3_600_000
  const reset = AT + 3 * HOUR
  const fiveHour = (percent: number) => ({ minutes: 300, percent, resetsAt: reset })

  it('measures elapsed time and projects the average forward only when it runs out before the reset', () => {
    // 2 of 5 hours gone (40 %).
    expect(windowPace(fiveHour(20), AT)).toEqual({ exhausted: false, elapsed: 0.4, basis: 'average' })
    const ahead = windowPace(fiveHour(62), AT)
    expect(ahead.elapsed).toBe(0.4)
    // 62 % in 2 h → the last 38 % takes ~1.23 h.
    expect(ahead.runsOutAt).toBe(Math.round(AT + (38 / 62) * 2 * HOUR))
    expect(windowPace(fiveHour(100), AT)).toEqual({ exhausted: true, elapsed: 0.4 })
    expect(windowPace({ minutes: 300, percent: 50 }, AT)).toEqual({ exhausted: false })
  })

  it('projects the recent slope when there is one: a burst shows at once, a pause stops the alarm', () => {
    // 30 % after 2 h is on pace on average, but 20 %/h lately runs out in 3.5 h — after the reset in 3 h, so fine;
    // 40 %/h runs out in 1.75 h, before it.
    expect(windowPace({ ...fiveHour(30), rate: 20 }, AT)).toEqual({ exhausted: false, elapsed: 0.4, basis: 'recent' })
    expect(windowPace({ ...fiveHour(30), rate: 40 }, AT).runsOutAt).toBe(AT + 1.75 * HOUR)
    expect(paceNote({ ...fiveHour(30), rate: 40 }, AT)).toMatch(/^时间过了 40%，用得比时间快 · 按最近的速度约 .+ 用完$/)
    // 62 % on average would run out, but nothing was used lately.
    expect(windowPace({ ...fiveHour(62), rate: 0 }, AT).runsOutAt).toBeUndefined()
    expect(paceNote({ ...fiveHour(62), rate: 0 }, AT)).toBe('时间过了 40% · 按最近的速度用得完')
    // Below 10 % no projection at all.
    expect(paceNote({ ...fiveHour(8), rate: 50 }, AT)).toBe('时间过了 40%')
  })

  it('does not project from the first minutes of a window', () => {
    const fresh = { minutes: 300, percent: 30, resetsAt: AT + 300 * 60_000 - 5 * 60_000 }
    expect(windowPace(fresh, AT).runsOutAt).toBeUndefined()
    expect(paceNote(fresh, AT)).toBe('时间过了 2%')
  })

  it('writes the chip and the window note', () => {
    expect(usageChipText(fiveHour(62), AT)).toBe('5h 62%')
    expect(usageChipText(fiveHour(100), AT)).toMatch(/^5h 用完 · (\d\d:\d\d|\d+ 月 \d+ 日 \d\d:\d\d) 恢复$/)
    expect(paceNote(fiveHour(20), AT)).toBe('时间过了 40% · 按这个速度用得完')
    expect(paceNote(fiveHour(62), AT)).toMatch(/^时间过了 40%，用得比时间快 · 按这个速度约 .+ 用完$/)
    expect(paceNote(fiveHour(100), AT)).toBe('已用完 · 还有 3 小时恢复')
    expect(paceNote({ minutes: 300, percent: 50 }, AT)).toBe('')
  })

  it('formats durations and clock times', () => {
    expect(formatDuration(38 * 60_000)).toBe('38 分钟')
    expect(formatDuration(125 * 60_000)).toBe('2 小时 5 分钟')
    expect(formatDuration(27 * HOUR)).toBe('1 天 3 小时')
    const noon = new Date(2026, 9, 19, 12, 0).getTime()
    expect(formatClock(new Date(2026, 9, 19, 17, 10).getTime(), noon)).toBe('17:10')
    expect(formatClock(new Date(2026, 9, 20, 9, 5).getTime(), noon)).toBe('10 月 20 日 09:05')
    expect(formatUpdatedNote(noon - 60_000, noon)).toBe('1 分钟前更新')
    expect(formatUpdatedNote(noon - 35 * 60_000, noon)).toBe('35 分钟前更新 · 可能不是最新')
  })
})

describe('Figma 33 · 额度页', () => {
  const HOUR = 3_600_000
  const reset = AT + 3 * HOUR
  // 2 of 5 hours gone: the pace is 40 %.
  const fiveHour = (percent: number) => ({ minutes: 300, percent, resetsAt: reset })

  it('draws the pace under the used part, and the part past it as over', () => {
    expect(paceBar(fiveHour(28), AT)).toEqual({ used: 28, over: 0, pace: 40, ahead: false, exhausted: false })
    expect(paceBar(fiveHour(84), AT)).toEqual({ used: 40, over: 44, pace: 40, ahead: true, exhausted: false })
    expect(paceBar(fiveHour(100), AT)).toEqual({ used: 100, over: 0, ahead: false, exhausted: true })
    expect(paceBar({ minutes: 300, percent: 50 }, AT)).toEqual({ used: 50, over: 0, ahead: false, exhausted: false })
  })

  it('lists the fullest vendor first, Claude first on a tie and before a vendor without figures', () => {
    const claude = { vendor: 'claude' as const, at: AT, windows: [fiveHour(28)] }
    const codex = { vendor: 'codex' as const, at: AT, windows: [fiveHour(84)] }
    const rows = [{ vendor: 'claude' as const }, { vendor: 'codex' as const }]
    expect(orderByTightest(rows, { claude, codex }, AT).map((r) => r.vendor)).toEqual(['codex', 'claude'])
    expect(orderByTightest(rows, { claude }, AT).map((r) => r.vendor)).toEqual(['claude', 'codex'])
    expect(orderByTightest([...rows].reverse(), {}, AT).map((r) => r.vendor)).toEqual(['claude', 'codex'])
  })

  it('names the plan, or says why there are no figures', () => {
    expect(planLabel('max')).toBe('Max')
    expect(planLabel('chatgpt_plus')).toBe('Plus')
    expect(planLabel('team')).toBe('Team')
    const usage = { vendor: 'codex' as const, at: AT, windows: [fiveHour(30)] }
    expect(vendorStatus(usage, { vendor: 'codex', state: 'ok', plan: 'plus', at: AT }, AT)).toEqual({ text: 'Plus', windows: [fiveHour(30)] })
    expect(vendorStatus(usage, undefined, AT).text).toBe('')
    expect(vendorStatus(undefined, { vendor: 'codex', state: 'api-key', at: AT }, AT)).toEqual({ text: 'API key 登录', windows: [] })
    expect(vendorStatus(undefined, { vendor: 'claude', state: 'outdated', at: AT }, AT).text).toBe('CLI 版本太旧')
    expect(vendorStatus(undefined, undefined, AT).text).toBe('读取中…')
    // Every window has reset since the account answered: no windows, and not 读取中… (nothing is being read).
    expect(vendorStatus({ ...usage, windows: [{ minutes: 300, percent: 90, resetsAt: AT - 1 }] }, { vendor: 'codex', state: 'ok', plan: 'plus', at: AT }, AT)).toEqual({ text: 'Plus', windows: [] })
  })
})

describe('Figma 18 · usage alerts', () => {
  it('maps a percentage to the highest level reached', () => {
    expect([0, 74, 75, 89, 90, 99, 100].map(usageAlertLevel)).toEqual([0, 0, 75, 75, 90, 90, 100])
  })

  it('names the vendor and window in the notification', () => {
    const resetsAt = AT + 2 * 3_600_000
    expect(usageAlertText({ vendor: 'claude', minutes: 300, percent: 90, level: 90, resetsAt }, AT).title).toBe('Claude 5 小时额度已用 90%')
    const done = usageAlertText({ vendor: 'codex', minutes: 10080, percent: 100, level: 100, resetsAt }, AT)
    expect(done.title).toBe('Codex 每周额度已用完')
    expect(done.body).toMatch(/恢复$/)
  })
})

describe('Figma 18 · context history', () => {
  const turns = (...tokens: number[]) => tokens.map((t, i) => ({ at: 1000 + i * 10, tokens: t }))

  it('splits the series where the conversation was compacted', () => {
    const history = { turns: turns(20_000, 60_000, 160_000, 30_000, 50_000), compactions: [1025] }
    expect(contextSegments(history, 200_000)).toEqual([[10, 30, 80], [15, 25]])
    expect(contextSegments({ turns: [], compactions: [] }, 200_000)).toEqual([])
    expect(contextSegments(history, 0)).toEqual([])
  })

  it('projects from the recent average growth, and only with enough turns', () => {
    expect(contextProjection([10, 20])).toBeNull()
    expect(contextProjection([40, 50, 60])).toBe('按最近 2 轮的增速，大约 2 轮后超过 80%')
    expect(contextProjection([40, 47, 55, 62])).toBe('按最近 3 轮的增速，大约 2–3 轮后超过 80%')
    expect(contextProjection([70, 80, 86])).toBe('按最近 2 轮的增速，大约 1–2 轮后用满')
    expect(contextProjection([50, 50, 50])).toBeNull()
  })

  it('lays out the sparkline with a gap per compaction', () => {
    const line = sparkline([[0, 100], [50]], 100, 50)
    expect(line.paths).toEqual(['M0 50 L50 0', 'M100 25'])
    expect(line.breaks).toEqual([75])
    expect(line.last).toEqual({ x: 100, y: 25 })
    expect(line.guideY).toBe(10)
    expect(sparkline([], 100, 50).paths).toEqual([])
  })
})

describe('Figma 18 · session shares', () => {
  const label = (id: string) => (id.startsWith('gone') ? null : { title: `T${id}`, project: 'acme' })

  it('lists the biggest open sessions, then the rest and the closed ones, adding up to 100', () => {
    const rows = shareRows(
      [
        { sessionId: 'a', tokens: 460 },
        { sessionId: 'b', tokens: 280 },
        { sessionId: 'c', tokens: 100 },
        { sessionId: 'd', tokens: 60 },
        { sessionId: 'e', tokens: 30 },
        { sessionId: 'gone1', tokens: 70 }
      ],
      label
    )
    expect(rows.map((r) => [r.sessionId, r.title, r.percent])).toEqual([
      ['a', 'Ta', 46],
      ['b', 'Tb', 28],
      ['c', 'Tc', 10],
      ['d', 'Td', 6],
      [null, '其他 1 个会话', 3],
      [null, '已关闭的会话', 7]
    ])
    expect(rows.reduce((n, r) => n + r.percent, 0)).toBe(100)
  })

  it('shows nothing for a single session', () => {
    expect(shareRows([{ sessionId: 'a', tokens: 5 }, { sessionId: 'b', tokens: 0 }], label)).toEqual([])
  })

  it('uses the shortest live window with a reset time', () => {
    const usage: VendorUsage = {
      vendor: 'claude',
      at: AT,
      windows: [
        { minutes: 10080, percent: 20, resetsAt: AT + 1e8 },
        { minutes: 300, percent: 40, resetsAt: AT + 1e6 }
      ]
    }
    expect(shareWindow(usage, AT)?.minutes).toBe(300)
    expect(shareWindow(usage, AT + 2e6)?.minutes).toBe(10080)
    expect(formatUsd(3.4217)).toBe('$3.42')
    expect(formatUsd(128.4)).toBe('$128')
  })
})
