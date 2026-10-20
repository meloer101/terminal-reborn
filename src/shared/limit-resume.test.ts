import { describe, expect, it } from 'vitest'
import {
  armedLabel,
  bindingWindows,
  decideResume,
  holdText,
  isTypedInput,
  limitStop,
  RESUME_TIMING,
  resumeDueAt,
  resumeScreen,
  stopNote,
  stoppedLikeLimit,
  type LimitStopInput,
  type ResumeCheck,
  type ResumePlan,
  type StopView
} from './limit-resume'
import type { VendorUsage } from './session-meta'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = new Date(2026, 9, 20, 15, 5).getTime()
const RESET = NOW + 2 * HOUR + 17 * MIN // 17:22

const claudeError: StopView = { kind: 'claude', status: 'error', phase: 'ready', turnStartedAt: NOW - MIN, finishedAt: NOW - HOUR }
const rateLimit = { reason: 'rate_limit', message: "You've hit your session limit · resets 5:22pm (America/Bogota)" }

function usage(windows: VendorUsage['windows'], at = NOW, vendor: VendorUsage['vendor'] = 'claude'): VendorUsage {
  return { vendor, windows, at }
}
const fiveHourOut = usage([
  { minutes: 300, percent: 100, resetsAt: RESET },
  { minutes: 10080, percent: 42, resetsAt: RESET + 4 * 24 * HOUR }
])

function input(patch: Partial<LimitStopInput> = {}): LimitStopInput {
  return { session: claudeError, failure: rateLimit, offPlan: false, usage: fiveHourOut, now: NOW, ...patch }
}

describe('stoppedLikeLimit', () => {
  it('Claude: an error from a rate_limit StopFailure', () => {
    expect(stoppedLikeLimit(claudeError, rateLimit)).toBe(true)
    expect(stoppedLikeLimit(claudeError, { reason: 'overloaded' })).toBe(false)
    expect(stoppedLikeLimit(claudeError, undefined)).toBe(false)
    expect(stoppedLikeLimit({ ...claudeError, status: 'running' }, rateLimit)).toBe(false)
    // The agent is gone or restarting: nothing to type into.
    expect(stoppedLikeLimit({ ...claudeError, phase: 'exited' }, rateLimit)).toBe(false)
  })

  it('Codex: a turn that began and never got its Stop, back to idle (§6.7)', () => {
    const codex: StopView = { kind: 'codex', status: 'idle', phase: 'ready', turnStartedAt: NOW - MIN, finishedAt: NOW - HOUR }
    expect(stoppedLikeLimit(codex, undefined)).toBe(true)
    expect(stoppedLikeLimit({ ...codex, finishedAt: undefined }, undefined)).toBe(true)
    expect(stoppedLikeLimit({ ...codex, status: 'done_unread' }, undefined)).toBe(true)
    // It finished normally, or never ran a turn, or is running.
    expect(stoppedLikeLimit({ ...codex, finishedAt: NOW }, undefined)).toBe(false)
    expect(stoppedLikeLimit({ ...codex, turnStartedAt: undefined }, undefined)).toBe(false)
    expect(stoppedLikeLimit({ ...codex, status: 'running' }, undefined)).toBe(false)
  })

  it('plain terminals never', () => {
    expect(stoppedLikeLimit({ kind: 'shell', status: 'error' }, rateLimit)).toBe(false)
  })
})

describe('limitStop', () => {
  it('names the used-up window and when it resets', () => {
    expect(limitStop(input())).toEqual({ vendor: 'claude', resetsAt: RESET, window: { minutes: 300, percent: 100, resetsAt: RESET } })
  })

  it('needs the account to be used up: a transient 429 or an old reading is no plan limit', () => {
    expect(limitStop(input({ usage: usage([{ minutes: 300, percent: 97, resetsAt: RESET }]) }))).toBeNull()
    expect(limitStop(input({ usage: undefined }))).toBeNull()
    // The window already reset.
    expect(limitStop(input({ now: RESET + 1 }))).toBeNull()
    // A used-up window without a reset time: nothing to wait for.
    expect(limitStop(input({ usage: usage([{ minutes: 300, percent: 100 }]) }))).toBeNull()
  })

  it('not for a session off its plan (a third-party endpoint: "Request rejected (429)")', () => {
    expect(limitStop(input({ offPlan: true }))).toBeNull()
  })

  it('waits for the latest reset when several windows are used up', () => {
    const weekly = RESET + 3 * 24 * HOUR
    const both = usage([
      { minutes: 300, percent: 100, resetsAt: RESET },
      { minutes: 10080, percent: 100, resetsAt: weekly }
    ])
    expect(limitStop(input({ usage: both }))?.resetsAt).toBe(weekly)
  })

  it('Codex reads its own vendor', () => {
    const codex: StopView = { kind: 'codex', status: 'idle', phase: 'ready', turnStartedAt: NOW - MIN }
    const out = usage([{ minutes: 300, percent: 100, resetsAt: RESET }], NOW, 'codex')
    expect(limitStop({ session: codex, offPlan: false, usage: out, now: NOW })).toMatchObject({ vendor: 'codex', resetsAt: RESET })
  })
})

describe('bindingWindows', () => {
  const sonnet = { minutes: 10080, scope: 'Sonnet', percent: 100, resetsAt: RESET + 2 * 24 * HOUR }
  it('ignores another model’s used-up weekly limit when an account-wide window stopped it', () => {
    const u = usage([{ minutes: 300, percent: 100, resetsAt: RESET }, sonnet])
    expect(bindingWindows(u, rateLimit.message, NOW).map((w) => w.minutes)).toEqual([300])
  })
  it('counts it when Claude named it, or when nothing else is used up', () => {
    const u = usage([{ minutes: 300, percent: 100, resetsAt: RESET }, sonnet])
    expect(bindingWindows(u, "You've hit your Sonnet limit · resets Oct 23", NOW)).toHaveLength(2)
    expect(bindingWindows(usage([sonnet]), rateLimit.message, NOW)).toEqual([sonnet])
  })
})

describe('decideResume', () => {
  const plan: ResumePlan = { vendor: 'claude', resetsAt: RESET, armedAt: NOW }
  const due = RESET + RESUME_TIMING.marginMs
  const after = usage([{ minutes: 300, percent: 2, resetsAt: RESET + 5 * HOUR }], due + 1_000)
  const check = (patch: Partial<ResumeCheck> = {}): ResumeCheck => ({ now: due, stopped: true, usage: after, message: rateLimit.message, screen: 'ready', ...patch })

  it('is due a margin after the reset', () => {
    expect(resumeDueAt(plan)).toBe(due)
    expect(decideResume(plan, check({ now: NOW }))).toEqual({ kind: 'wait', at: due, refresh: false })
  })

  it('sends once a reading after the reset says the limit is gone and the input line is free', () => {
    expect(decideResume(plan, check({ now: due + 1_000 }))).toEqual({ kind: 'send' })
  })

  it('is called off as soon as the session left the stop (typed into, went on by itself, restarted)', () => {
    expect(decideResume(plan, check({ now: NOW, stopped: false }))).toEqual({ kind: 'cancel' })
    expect(decideResume(plan, check({ stopped: false }))).toEqual({ kind: 'cancel' })
  })

  it('asks for a fresh reading, then trusts the passed reset time after a while', () => {
    const stale = fiveHourOut // read before the reset; its window has reset by now
    expect(decideResume(plan, check({ usage: stale }))).toEqual({ kind: 'wait', at: due + RESUME_TIMING.pollMs, refresh: true })
    const late = due + RESUME_TIMING.freshWaitMs - 1_000
    expect(decideResume(plan, check({ usage: stale, now: late }))).toEqual({ kind: 'wait', at: due + RESUME_TIMING.freshWaitMs, refresh: true })
    expect(decideResume(plan, check({ usage: stale, now: due + RESUME_TIMING.freshWaitMs }))).toEqual({ kind: 'send' })
    expect(decideResume(plan, check({ usage: undefined, now: due + RESUME_TIMING.freshWaitMs }))).toEqual({ kind: 'send' })
  })

  it('moves to the later reset a fresh reading reports', () => {
    const later = RESET + 30 * MIN
    const still = usage([{ minutes: 300, percent: 100, resetsAt: later }], due)
    expect(decideResume(plan, check({ usage: still }))).toEqual({ kind: 'postpone', resetsAt: later })
    expect(decideResume(plan, check({ usage: usage([{ minutes: 300, percent: 100 }], due) }))).toEqual({ kind: 'hold', reason: 'still-limited' })
  })

  it('never types into a dialog, or over the agent’s own countdown', () => {
    expect(decideResume(plan, check({ now: due + 1_000, screen: 'dialog' }))).toEqual({ kind: 'hold', reason: 'dialog' })
    expect(decideResume(plan, check({ now: due + 1_000, screen: 'unknown' }))).toEqual({ kind: 'hold', reason: 'dialog' })
    expect(decideResume(plan, check({ now: due + 1_000, screen: 'agent-continues' }))).toEqual({ kind: 'hold', reason: 'agent-continues' })
  })

  it('honours a shorter timing (e2e)', () => {
    const fast = { marginMs: 500, freshWaitMs: 200, pollMs: 50 }
    expect(decideResume(plan, check({ now: RESET + 100 }), fast)).toEqual({ kind: 'wait', at: RESET + 500, refresh: false })
    expect(decideResume(plan, check({ now: RESET + 700, usage: undefined }), fast)).toEqual({ kind: 'send' })
  })
})

describe('resumeScreen', () => {
  const claudeIdle = [
    "❯ Reply with only the word OK.",
    "  ⎿  You've hit your session limit · resets 5:22pm (America/Bogota)",
    '',
    '✻ Baked for 0s · done 3:05 PM',
    '────────────────────',
    '❯ ',
    '────────────────────',
    '  ⏵⏵ auto mode on (shift+tab to cycle)'
  ].join('\n')

  it('Claude at its input line (captured, 2.1.304)', () => {
    expect(resumeScreen('claude', claudeIdle)).toBe('ready')
  })

  it("Claude's /rate-limit-options dialog and other dialogs", () => {
    const options = ['What do you want to do?', '❯ 1. Wait here, then continue automatically at 5:22pm', '  2. Stop and wait for limit to reset', '', 'Enter to confirm · Esc to cancel'].join('\n')
    expect(resumeScreen('claude', options)).toBe('dialog')
    expect(resumeScreen('claude', 'Do you want to proceed?\n❯ 1. Yes\n  2. No\n\nEsc to cancel · Tab to amend')).toBe('dialog')
    // A reply that asks in prose is no dialog.
    expect(resumeScreen('claude', '⏺ Do you want to keep the old API?\n\n❯ ')).toBe('ready')
  })

  it("Claude's own continue (autoContinueAtUsageLimit)", () => {
    expect(resumeScreen('claude', `${claudeIdle}\nUsage limit reached · continuing automatically at 5:22pm · esc to cancel`)).toBe('agent-continues')
    expect(resumeScreen('claude', 'Claude Code will continue automatically at 5:22pm. Keep this session open\n❯ ')).toBe('agent-continues')
  })

  it("Codex's cheaper-model pop-up after a limit (captured, 0.142.5)", () => {
    const nudge = [
      "■ You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit",
      'https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 5:23 PM.',
      '  Approaching rate limits',
      '  Switch to gpt-5.4-mini for lower credit usage?',
      '› 1. Switch to gpt-5.4-mini                 Small, fast, and cost-efficient model for simpler coding tasks.',
      '  2. Keep current model',
      '  3. Keep current model (never show again)  Hide future rate limit reminders about switching models.',
      '  Press enter to confirm or esc to go back'
    ].join('\n')
    expect(resumeScreen('codex', nudge)).toBe('dialog')
    const idle = "■ You've hit your usage limit. … or try again at 5:23 PM.\n\n› Summarize recent commits\n  gpt-6-sol medium · ~/repo"
    expect(resumeScreen('codex', idle)).toBe('ready')
  })

  it('no input line in sight', () => {
    expect(resumeScreen('claude', 'some shell output\n$ ')).toBe('unknown')
    expect(resumeScreen('codex', '')).toBe('unknown')
  })
})

describe('isTypedInput', () => {
  it('keys, Enter, Esc and pastes are typing', () => {
    for (const data of ['x', '继续', '\r', '\x1b', '\x1b[A', '\x7f', '\x1b[200~text\x1b[201~']) expect(isTypedInput(data)).toBe(true)
  })
  it("the terminal's own replies and reports are not", () => {
    for (const data of ['\x1b[I', '\x1b[O', '\x1b[<64;10;5M', '\x1b[<0;3;4m', '\x1b[M`!!', '\x1b[12;40R', '\x1b[?1;2c', '\x1b]11;rgb:0000/0000/0000\x07']) {
      expect(isTypedInput(data)).toBe(false)
    }
    expect(isTypedInput('\x1b[<64;10;5M\x1b[<64;10;5M')).toBe(false)
  })
})

describe('copy', () => {
  it('reads like the usage chip', () => {
    const plan = { resetsAt: RESET }
    expect(armedLabel(plan, NOW)).toBe('17:23 发送“继续”')
    expect(stopNote({ vendor: 'claude', resetsAt: RESET }, NOW)).toBe('Claude 额度用完 · 17:22 恢复')
    expect(holdText('dialog', 'codex')).toContain('选择框')
    expect(holdText('agent-continues', 'claude')).toContain('Claude 会自己继续')
  })
})
