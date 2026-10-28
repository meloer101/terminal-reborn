// Asks the account itself for its plan usage now and then (PRD F11, §6.6 / §6.7), instead of waiting for a session to
// get a response back: a session's statusLine / rollout only says what its own last response said, so idle sessions
// never update and use outside Wavi (claude.ai, Codex desktop, other machines) never shows. The account answer also
// has the windows a session never sees (a model's own weekly limit). Electron-free: the fetch and the timers are given.
//
// Cadence: faster while the vendor is in use here (a hook or a reading in the last 10 minutes) and the closer its
// fullest window is to the limit; slow when idle; never before anything says the vendor is used. An account that has
// no plan limits (API key, third-party provider) is left alone until the vendor is used again, 30 minutes later.
// The 额度 page asks every vendor once when it opens, used here or not (`refresh(true)`); that one answer does not
// start the cadence of a vendor never used here.
import type { UsageAccount, UsageAccountState, UsageVendor, VendorUsage } from '@shared/session-meta'

/** Why an account will not say: the 额度 page's status for that vendor. */
export type UnsupportedState = Exclude<UsageAccountState, 'ok' | 'error'>

export type PollOutcome =
  /** The account answered; null when it has no plan windows right now. `plan` as the CLI names it. */
  | { kind: 'ok'; usage: VendorUsage | null; plan?: string }
  /** It never will (API-key login, CLI too old or missing): stop until the vendor is used again. */
  | { kind: 'unsupported'; state: UnsupportedState; detail: string }
  | { kind: 'error'; detail: string; retryAfterMs?: number }

/** In use: a hook or a reading of this vendor within this long. */
export const ACTIVE_MS = 10 * 60_000
/** After an unsupported answer, the next use of the vendor tries again only after this long. */
export const UNSUPPORTED_RETRY_MS = 30 * 60_000
/** Failures back off from 1 minute, doubling, up to this. */
export const MAX_BACKOFF_MS = 30 * 60_000

export interface PollerOptions {
  vendor: UsageVendor
  fetch(): Promise<PollOutcome>
  apply(usage: VendorUsage): void
  /**
   * A one-off ask's figures (the 额度 page, a vendor not used here): shown, not kept — kept usage starts the cadence on
   * the next run (PRD F11 · 额度页) — and no alert. Without it they go to `apply`.
   */
  show?(usage: VendorUsage): void
  /** What the account said, after every ask. */
  account?(account: UsageAccount): void
  /** The wait after an answer, given whether the vendor is in use and its fullest window (0–100). */
  interval(active: boolean, topPercent: number): number
  /** On-demand refreshes (the usage popover opened) come no closer than this to the last poll. */
  minRefreshGapMs: number
  log?(message: string): void
  now?(): number
  setTimer?(fn: () => void, ms: number): unknown
  clearTimer?(handle: unknown): void
}

export class PlanUsagePoller {
  private timer: unknown = null
  private dueAt = Infinity
  private inFlight: Promise<void> | null = null
  private lastActivity = -Infinity
  private lastPollAt = -Infinity
  private failures = 0
  private unsupportedAt: number | null = null
  private top = 0
  private started = false
  private stopped = false

  constructor(private readonly o: PollerOptions) {}

  private now(): number {
    return this.o.now?.() ?? Date.now()
  }

  private active(): boolean {
    return this.now() - this.lastActivity < ACTIVE_MS
  }

  /** Starts the slow cadence: the vendor was used before (its usage is held from an earlier run). */
  start(): void {
    if (this.started || this.stopped) return
    this.started = true
    this.schedule(0)
  }

  /** The vendor is in use here (a hook, a launch, a reading): poll at the active cadence, starting now if idle. */
  nudge(): void {
    if (this.stopped) return
    const now = this.now()
    this.lastActivity = now
    if (this.unsupportedAt !== null) {
      if (now - this.unsupportedAt < UNSUPPORTED_RETRY_MS) return
      this.unsupportedAt = null
      this.failures = 0
    }
    this.started = true
    if (this.inFlight || this.failures > 0) return
    const due = Math.max(0, this.lastPollAt + this.o.interval(true, this.top) - now)
    if (now + due < this.dueAt) this.schedule(due)
  }

  /**
   * Someone is looking (the usage popover): poll now unless the last poll was very recent. `all` (the 额度 page) also
   * asks a vendor never used here, once, and one that said it has no plan figures (it may have been signed in since).
   */
  refresh(all = false): void {
    if (this.stopped || this.inFlight) return
    if (!all && (!this.started || this.unsupportedAt !== null)) return
    if (this.now() - this.lastPollAt < this.o.minRefreshGapMs) return
    if (this.started && this.unsupportedAt === null) this.schedule(0)
    else void this.poll()
  }

  /** The account's latest figures (from any source): the cadence follows the fullest window. */
  observe(usage: VendorUsage): void {
    this.top = usage.windows.reduce((m, w) => Math.max(m, w.percent), 0)
  }

  stop(): void {
    this.stopped = true
    this.cancel()
  }

  private cancel(): void {
    if (this.timer !== null) (this.o.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>)
    this.timer = null
    this.dueAt = Infinity
  }

  private schedule(ms: number): void {
    this.cancel()
    this.dueAt = this.now() + ms
    const set = this.o.setTimer ?? ((fn: () => void, wait: number) => setTimeout(fn, wait).unref())
    this.timer = set(() => {
      this.timer = null
      this.dueAt = Infinity
      void this.poll()
    }, ms)
  }

  private poll(): Promise<void> {
    if (this.inFlight || this.stopped) return this.inFlight ?? Promise.resolve()
    this.lastPollAt = this.now()
    this.inFlight = this.o
      .fetch()
      .catch((error: unknown): PollOutcome => ({ kind: 'error', detail: error instanceof Error ? error.message : String(error) }))
      .then((outcome) => this.settle(outcome))
      .finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }

  private settle(outcome: PollOutcome): void {
    if (this.stopped) return
    const at = this.now()
    if (outcome.kind === 'unsupported') {
      this.o.log?.(`${this.o.vendor} plan usage is not available: ${outcome.detail}`)
      this.o.account?.({ vendor: this.o.vendor, state: outcome.state, at })
      this.unsupportedAt = at
      this.cancel()
      return
    }
    if (outcome.kind === 'error') {
      this.o.log?.(`${this.o.vendor} plan usage poll failed: ${outcome.detail}`)
      this.o.account?.({ vendor: this.o.vendor, state: 'error', at })
      // A one-off ask (the 额度 page) of a vendor never used here does not keep trying, nor hold back the first use.
      if (!this.started) return
      this.failures++
      const backoff = Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** (this.failures - 1))
      this.schedule(Math.max(backoff, Math.min(outcome.retryAfterMs ?? 0, 60 * 60_000)))
      return
    }
    this.failures = 0
    this.unsupportedAt = null
    // Signed in with a plan but no window right now says the same as a login without one.
    const account: UsageAccount = { vendor: this.o.vendor, state: outcome.usage ? 'ok' : 'no-plan', at }
    if (outcome.plan) account.plan = outcome.plan
    this.o.account?.(account)
    if (outcome.usage) {
      this.observe(outcome.usage)
      if (this.started || !this.o.show) this.o.apply(outcome.usage)
      else this.o.show(outcome.usage)
    }
    if (this.started) this.schedule(this.o.interval(this.active(), this.top))
  }
}

/** Codex's own TUI cadence (0.154+): every 60 s in use, 30 s from 75 %, 15 s from 90 %; idle every 10 minutes. */
export function codexInterval(active: boolean, top: number): number {
  if (!active) return 10 * 60_000
  if (top >= 90) return 15_000
  if (top >= 75) return 30_000
  return 60_000
}

/**
 * Claude's usage endpoint turns away clients that ask too often (a 429 that can last an hour), and a running session's
 * statusLine already brings the live 5 h / 7 d figures: every 5 minutes in use (2 from 90 %), 15 when idle.
 */
export function claudeInterval(active: boolean, top: number): number {
  if (!active) return 15 * 60_000
  return top >= 90 ? 2 * 60_000 : 5 * 60_000
}
