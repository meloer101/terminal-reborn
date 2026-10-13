// Executes a SendStep[] plan (src/shared/send-protocol.ts) against a live session.
// Has no Electron/xterm dependency: the caller supplies SendIo, tests supply a fake one.

import type { SendIo, SendStep } from './send-protocol'

export interface SendClock {
  now(): number
  sleep(ms: number): Promise<void>
}

export const realClock: SendClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}

export interface RunSendOptions {
  /** How often `readScreen()` is polled while waiting for text. Default 25 ms. */
  pollMs?: number
  /** Abort (e.g. the session was closed). The run rejects with SendAbortedError. */
  signal?: AbortSignal
}

export class SendTimeoutError extends Error {
  readonly name = 'SendTimeoutError'
  constructor(
    readonly stepIndex: number,
    readonly needles: string[],
    readonly timeoutMs: number,
    /** Last lines of the screen at the time of failure, for diagnostics. */
    readonly screenTail: string
  ) {
    super(`Timed out after ${timeoutMs} ms waiting for ${JSON.stringify(needles)} (step ${stepIndex})`)
  }
}

export class SendAbortedError extends Error {
  readonly name = 'SendAbortedError'
  constructor(readonly stepIndex: number) {
    super(`Send aborted at step ${stepIndex}`)
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0
  let n = 0
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    n++
    at = haystack.indexOf(needle, at + needle.length)
  }
  return n
}

function tail(screen: string, lines = 12): string {
  return screen.split('\n').slice(-lines).join('\n')
}

/**
 * Run the plan in order. `waitForText` succeeds when the number of occurrences of ANY of its needles in the
 * screen exceeds the number seen when the run started, so an older identical message in the scrollback cannot
 * satisfy it. Throws SendTimeoutError / SendAbortedError; on failure nothing is written for later steps.
 */
export async function runSendPlan(
  steps: readonly SendStep[],
  io: SendIo,
  clock: SendClock = realClock,
  options: RunSendOptions = {}
): Promise<void> {
  const pollMs = options.pollMs ?? 25
  const signal = options.signal

  const baseline = new Map<string, number>()
  const startScreen = steps.some((s) => s.type === 'waitForText') ? io.readScreen() : ''
  for (const step of steps) {
    if (step.type !== 'waitForText') continue
    for (const needle of step.needles) {
      if (!baseline.has(needle)) baseline.set(needle, countOccurrences(startScreen, needle))
    }
  }

  const checkAbort = (i: number): void => {
    if (signal?.aborted) throw new SendAbortedError(i)
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as SendStep
    checkAbort(i)
    if (step.type === 'write') {
      io.write(step.data)
    } else if (step.type === 'delay') {
      await clock.sleep(step.ms)
    } else {
      if (step.needles.length === 0) continue
      const deadline = clock.now() + step.timeoutMs
      for (;;) {
        const screen = io.readScreen()
        const seen = step.needles.some((n) => countOccurrences(screen, n) > (baseline.get(n) ?? 0))
        if (seen) break
        if (clock.now() >= deadline) throw new SendTimeoutError(i, step.needles, step.timeoutMs, tail(screen))
        await clock.sleep(pollMs)
        checkAbort(i)
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Serial queue: two sends to the same PTY must never interleave.
// ---------------------------------------------------------------------------------------------

export interface SendQueue {
  /** Run `task` after every earlier task for `key` settled. A failing task does not block the next one. */
  enqueue<T>(key: string, task: () => Promise<T>): Promise<T>
  /** Tasks queued or running for `key`. */
  pending(key: string): number
}

export function createSendQueue(): SendQueue {
  const tails = new Map<string, Promise<unknown>>()
  const counts = new Map<string, number>()

  return {
    enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve()
      counts.set(key, (counts.get(key) ?? 0) + 1)
      const run = previous.then(task, task)
      const settled = run.then(
        () => undefined,
        () => undefined
      )
      tails.set(key, settled)
      void settled.then(() => {
        const left = (counts.get(key) ?? 1) - 1
        if (left <= 0) {
          counts.delete(key)
          if (tails.get(key) === settled) tails.delete(key)
        } else {
          counts.set(key, left)
        }
      })
      return run
    },
    pending(key: string): number {
      return counts.get(key) ?? 0
    }
  }
}

/** Convenience: plan-run through a queue. */
export function sendQueued(
  queue: SendQueue,
  key: string,
  steps: readonly SendStep[],
  io: SendIo,
  clock?: SendClock,
  options?: RunSendOptions
): Promise<void> {
  return queue.enqueue(key, () => runSendPlan(steps, io, clock, options))
}
