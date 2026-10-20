// Status under whole simulated sessions (src/shared/agent-sim.ts): raw hooks through normalizeHook into the reducer,
// with titles, screen reads and ticks on the controller's schedule (src/renderer/status/bridge.ts), compared every
// 250 ms with what the agent really does. PRD §1.3: status may never be wrong for more than 2 minutes; without lost
// hooks it may only lag behind by the self-heal windows of PRD §3.1.
import { describe, expect, it } from 'vitest'
import { simulateSession, type SimOptions, type SimScript, type Truth } from '@shared/agent-sim'
import { initialState, reduce, ticksFast, watchesScreen, type SessionState, type Signal } from '@shared/session-state-machine'
import type { SessionStatus } from '@shared/types'
import { normalizeHook } from './normalize'

const T0 = 1_760_000_000_000
/** renderer/status/bridge.ts: ticks while something runs or a screen is watched, otherwise every 15 s. */
const FAST_TICK_MS = 1_000
const SLOW_TICK_MS = 15_000
/** renderer/status/bridge.ts: the screen is read this long after output, when it can matter. */
const SCREEN_CHECK_MS = 200
const SAMPLE_MS = 250

const ALLOWED: Record<Truth, SessionStatus[]> = {
  running: ['running'],
  needs_you: ['needs_you'],
  idle: ['idle', 'done_unread'],
  error: ['error'],
  exited: ['exited', 'error']
}

/** Metrics, names: not status (the renderer's StatusBridge drops them before the reducer). */
const NOT_STATUS = new Set(['agent-title', 'context', 'todos', 'agent-exit', 'billing'])

interface Wrong {
  ms: number
  at: number
  truth: Truth
  status: SessionStatus
}

/** Replays a script; returns the longest stretch the status was wrong, and every stretch longer than 1 s. */
function replay(script: SimScript, seed: number, allowed: Record<Truth, SessionStatus[]> = ALLOWED): { longest: Wrong; stretches: Wrong[]; final: SessionState } {
  let state = initialState(script.agent, T0, { status: 'idle', phase: 'starting' })
  let screen = ''
  let truth: Truth = 'idle'
  let nextTick = FAST_TICK_MS
  let screenCheckAt = Number.POSITIVE_INFINITY
  // The user looks at this session now and then (done_unread → idle); deterministic per seed.
  let viewing = false
  let nextView = 7_000 + (seed % 13) * 1_000
  const apply = (signal: Signal, t: number) => {
    const before = state
    state = reduce(state, signal, T0 + t)
    // The bridge hurries a slow tick when a session starts needing self-heal (StatusDeps.needsFastTicks).
    if (state !== before && ticksFast(state)) nextTick = Math.min(nextTick, t + FAST_TICK_MS)
  }
  const stretches: Wrong[] = []
  let wrong: Wrong | null = null
  const sample = (t: number) => {
    const ok = allowed[truth].includes(state.status)
    if (!ok && !wrong) wrong = { ms: 0, at: t, truth, status: state.status }
    else if (ok && wrong) {
      stretches.push({ ...wrong, ms: t - wrong.at })
      wrong = null
    }
  }

  let i = 0
  const steps = script.steps
  for (let t = 0; t <= script.end; t += 10) {
    for (; i < steps.length && (steps[i] as (typeof steps)[number]).at <= t; i++) {
      const step = steps[i] as (typeof steps)[number]
      switch (step.kind) {
        case 'truth':
          truth = step.truth
          break
        case 'title':
          apply({ type: 'title', title: step.title }, t)
          screenCheckAt = Math.min(screenCheckAt, t + SCREEN_CHECK_MS)
          break
        case 'screen':
          screen = step.text
          screenCheckAt = Math.min(screenCheckAt, t + SCREEN_CHECK_MS)
          break
        case 'exit':
          apply({ type: 'pty-exit', code: step.code }, t)
          break
        case 'hook':
          if (step.lost) break
          for (const event of normalizeHook(script.agent, step.hook, step.payload, T0 + t).events) {
            if (!NOT_STATUS.has(event.type)) apply({ type: 'event', event }, t)
          }
          break
      }
    }
    if (t >= screenCheckAt) {
      screenCheckAt = Number.POSITIVE_INFINITY
      if (watchesScreen(state)) apply({ type: 'screen', text: screen }, t)
    }
    if (t >= nextView) {
      viewing = !viewing
      apply({ type: viewing ? 'viewed' : 'unviewed' }, t)
      nextView = t + (viewing ? 4_000 : 23_000)
    }
    if (t >= nextTick) {
      // As StatusController.tick: the screen, the tick, the screen again if the tick changed something.
      if (watchesScreen(state)) apply({ type: 'screen', text: screen }, t)
      const before = state
      apply({ type: 'tick' }, t)
      if (state !== before && watchesScreen(state)) apply({ type: 'screen', text: screen }, t)
      nextTick = t + (ticksFast(state) ? FAST_TICK_MS : SLOW_TICK_MS)
    }
    if (t % SAMPLE_MS === 0) sample(t)
  }
  const open = wrong as Wrong | null
  if (open) stretches.push({ ...open, ms: script.end - open.at })
  const longest = stretches.reduce<Wrong>((a, b) => (b.ms > a.ms ? b : a), { ms: 0, at: 0, truth: 'idle', status: 'idle' })
  return { longest, stretches: stretches.filter((s) => s.ms > 1_000), final: state }
}

/** The steps around a moment, for a readable failure. */
function around(script: SimScript, at: number): string {
  return script.steps
    .filter((s) => s.at >= at - 15_000 && s.at <= at + 15_000)
    .map((s) => {
      const what = s.kind === 'hook' ? `${s.hook}${s.lost ? ' (lost)' : ''}${typeof s.payload.agent_id === 'string' ? `@${s.payload.agent_id}` : ''}${typeof s.payload.tool_name === 'string' ? ` ${s.payload.tool_name}` : ''}${typeof s.payload.notification_type === 'string' ? ` ${s.payload.notification_type}` : ''}` : s.kind === 'truth' ? `TRUTH ${s.truth} (${s.why})` : s.kind === 'title' ? `title ${s.title}` : s.kind === 'screen' ? `screen ${s.text.split('\n').at(-1)}` : `exit ${s.code}`
      return `${(s.at / 1000).toFixed(2)}s ${what}`
    })
    .join('\n')
}

/** TR_STATUS_SIM_STATS=1 prints how long and how often status was wrong (for PRD §3.1 / ROADMAP). */
function report(name: string, results: ReturnType<typeof runMany>): void {
  if (!process.env.TR_STATUS_SIM_STATS) return
  const longest = results.map((r) => r.longest.ms).sort((a, b) => a - b)
  const at = (q: number) => longest[Math.min(longest.length - 1, Math.floor(q * longest.length))] ?? 0
  let wrongMs = 0
  let totalMs = 0
  const kinds = new Map<string, number>()
  for (const r of results) {
    totalMs += r.script.end
    for (const w of r.stretches) {
      wrongMs += w.ms
      const kind = `${w.status}≠${w.truth}`
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
    }
  }
  console.log(
    `${name}: ${results.length} runs, ${(totalMs / 3_600_000).toFixed(1)} h simulated; longest wrong stretch per run p50 ${at(0.5)} ms, p95 ${at(0.95)} ms, max ${at(1)} ms; ` +
      `wrong > 1 s for ${((wrongMs / totalMs) * 100).toFixed(2)}% of the time; ${[...kinds].map(([k, n]) => `${k} ×${n}`).join(', ')}`
  )
}

function runMany(count: number, options: SimOptions, firstSeed: number, allowed = ALLOWED) {
  const results: { seed: number; script: SimScript; longest: Wrong; stretches: Wrong[] }[] = []
  for (let seed = firstSeed; seed < firstSeed + count; seed++) {
    const script = simulateSession(seed, options)
    const { longest, stretches, final } = replay(script, seed, allowed)
    expect(final.status, `seed ${seed} ended as ${final.status}`).toBe('exited')
    results.push({ seed, script, longest, stretches })
  }
  return results
}

describe('status against simulated sessions (PRD §3.1, §1.3)', () => {
  // How far status may lag behind with every hook delivered: Claude's idle-title heal after Esc (6 s + a tick),
  // the idle-footer heal after a dismissed dialog (2 s + reads), Codex's idle-title heal (4 s + a tick).
  const LAG_MS = 8_000

  it.each<[string, SimOptions, number, number]>([
    ['Claude Code, default permissions', { agent: 'claude' }, 300, 1],
    ['Claude Code, Auto mode', { agent: 'claude', auto: true }, 100, 5_001],
    ['Codex', { agent: 'codex' }, 200, 10_001]
  ])('%s: never wrong for longer than the self-heal windows', (name, options, count, firstSeed) => {
    const results = runMany(count, options, firstSeed)
    report(name, results)
    for (const { seed, script, longest } of results) {
      expect(longest.ms, `seed ${seed}: ${longest.status} while really ${longest.truth} for ${longest.ms} ms from ${longest.at / 1000}s\n${around(script, longest.at)}`).toBeLessThanOrEqual(LAG_MS)
    }
  })

  it.each<[string, SimOptions, number]>([
    ['Claude Code', { agent: 'claude', hookLoss: 0.05 }, 20_001],
    ['Codex', { agent: 'codex', hookLoss: 0.05 }, 30_001]
  ])('%s with 5%% of hooks lost: never wrong for 2 minutes', (name, options, firstSeed) => {
    const results = runMany(200, options, firstSeed)
    report(`${name}, 5% hooks lost`, results)
    for (const { seed, script, longest } of results) {
      expect(longest.ms, `seed ${seed}: ${longest.status} while really ${longest.truth} for ${longest.ms} ms from ${longest.at / 1000}s\n${around(script, longest.at)}`).toBeLessThan(60_000)
    }
  })

  it.each<[string, SimOptions, number]>([
    ['Claude Code', { agent: 'claude', hookLoss: 1 }, 40_001],
    ['Codex', { agent: 'codex', hookLoss: 1 }, 50_001]
  ])('%s with no hooks at all (status from titles and screen): never wrong for 2 minutes', (name, options, firstSeed) => {
    // Without StopFailure an API error looks like any finished turn.
    const results = runMany(200, options, firstSeed, { ...ALLOWED, error: ['error', 'idle', 'done_unread'] })
    report(`${name}, no hooks`, results)
    for (const { seed, script, longest } of results) {
      expect(longest.ms, `seed ${seed}: ${longest.status} while really ${longest.truth} for ${longest.ms} ms from ${longest.at / 1000}s\n${around(script, longest.at)}`).toBeLessThan(120_000)
    }
  })

  it('the runs cover parallel dialogs, subagents, background agents, teams, questions, plans, Esc and API errors', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 300; seed++) for (const feature of simulateSession(seed, { agent: 'claude' }).features) seen.add(feature)
    for (let seed = 10_001; seed <= 10_200; seed++) for (const feature of simulateSession(seed, { agent: 'codex' }).features) seen.add(`codex:${feature}`)
    expect([...seen].sort()).toEqual(
      expect.arrayContaining([
        'ask', 'parallel-asks', 'subagent-ask', 'subagents', 'background-agent', 'wake', 'background-bash', 'team',
        'question', 'plan', 'interrupt', 'api-error', 'clear', 'compact', 'codex:ask', 'codex:interrupt', 'codex:failed-request'
      ])
    )
  })
})
