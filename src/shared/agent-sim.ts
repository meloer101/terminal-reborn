// Seeded simulations of one agent session — what Claude Code or Codex really does over time (the ground truth) and
// what Wavi gets to see of it: the raw hook calls its relay posts, terminal titles, the screen's tail, the exit.
// They drive the status stress tests: src/main/hooks/status-sim.test.ts through the reducer, e2e/status-stress.spec.ts
// through a fake agent and the whole app (PRD §3.1; §1.3 "状态卡死 0 次").
//
// Modelled on measured behaviour (PRD §6.6 / §6.7, Claude Code 2.1.304 binary): PermissionRequest has no tool_use_id;
// a denied call sends no PostToolUse (on the main thread a denial without feedback ends the turn, with feedback and in
// a subagent the agent carries on); Esc sends no hook; Notification(permission_prompt) follows a dialog by 6 s;
// idle_prompt comes 60 s after a turn, only with no dialog up and no background agent; hooks inside a subagent carry
// `agent_id`; the TUI shows one dialog at a time, oldest first, with the idle title (✳). Background agents wake an
// idle main thread when they finish (UserPromptSubmit, source "system"). Codex: no Notification, SubagentStop or
// StopFailure; SessionStart only at the first prompt; its own dialog blinks `Action Required` in the title; Esc on
// that dialog or a failed request ends the turn with no Stop.

export type SimAgentKind = 'claude' | 'codex'
/** What the session really is: `idle` = waiting for the user's next prompt (Wavi may say idle or done_unread). */
export type Truth = 'running' | 'needs_you' | 'idle' | 'error' | 'exited'

export type SimStep =
  /** A hook the agent runs: `hook` is the event name, `payload` the JSON on its stdin. `lost`: it never arrives. */
  | { at: number; kind: 'hook'; hook: string; payload: Record<string, unknown>; lost: boolean }
  | { at: number; kind: 'title'; title: string }
  /** The tail of the screen from now on (what the idle-footer and dialog checks read). */
  | { at: number; kind: 'screen'; text: string }
  | { at: number; kind: 'exit'; code: number }
  | { at: number; kind: 'truth'; truth: Truth; why: string }

export interface SimScript {
  agent: SimAgentKind
  steps: SimStep[]
  /** Ms from the start when the run is over. */
  end: number
  /** The kinds of episodes the run contains (for the tests' coverage check). */
  features: Set<string>
}

export interface SimOptions {
  agent: SimAgentKind
  /** User turns in the run. Default 4. */
  turns?: number
  /** Chance that any one hook is lost on its way (curl failed, socket gone). Default 0. */
  hookLoss?: number
  /** Claude's Auto mode: the classifier approves most calls, so few dialogs. */
  auto?: boolean
}

export const SIM_SCREEN = {
  idle: '╭──────────╮\n│ ❯        │\n╰──────────╯\n  ? for shortcuts',
  busy: '✻ Working… (12s · esc to interrupt)\n╭──────────╮\n│ ❯        │\n╰──────────╯',
  dialog: 'Bash command\n  pnpm test\nDo you want to proceed?\n❯ 1. Yes\n  2. No\n\nEsc to cancel',
  question: '☐ 用哪个库？\n❯ 1. zod\n  2. valibot\n\nEnter to select · Esc to cancel',
  codexIdle: '›',
  codexBusy: '• Working (3s • esc to interrupt)\n›',
  codexDialog: 'Allow command?\n› 1. Yes\n  2. No'
} as const
export const SIM_CLAUDE_IDLE_TITLE = '✳ Claude Code'
// Claude 2.1.304 animates ◐ ◑ (older versions braille).
const CLAUDE_BUSY_TITLES = ['◐ Claude Code', '◑ Claude Code']
const CODEX_DIR = 'tr-sim'
const CODEX_BUSY_TITLES = [`⠋ ${CODEX_DIR}`, `⠙ ${CODEX_DIR}`, `⠹ ${CODEX_DIR}`]
const CODEX_ACTION_TITLES = [`[ ! ] Action Required | ${CODEX_DIR}`, `[ . ] Action Required | ${CODEX_DIR}`]

/** Claude's delay before Notification(permission_prompt) (2.1.304 `Dtn`). */
const PERMISSION_NOTIFY_MS = 6_000
/** Claude's idle_prompt threshold. */
const IDLE_NOTIFY_MS = 60_000
/** A run that has not ended by then is a bug in the simulation, not a long session. */
const MAX_SIM_MS = 6 * 3_600_000

type Decision = 'approve' | 'deny' | 'deny-feedback'
interface Dialog {
  actor: Actor
  kind: 'permission' | 'question'
  decision: Decision
  /** The main thread asked: a plain denial ends the whole turn. */
  main: boolean
}
/** A cooperative actor: yields how long to wait, or a dialog to wait on (resumed with the user's decision). */
type Wait = { sleep: number } | { ask: Omit<Dialog, 'actor'> }
type Actor = Generator<Wait, void, Decision | undefined>
type Task<T> = Generator<Wait, T, Decision | undefined>

function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Builds one run. Deterministic for a seed and options. */
export function simulateSession(seed: number, options: SimOptions): SimScript {
  const random = mulberry32(Math.imul(seed, 2654435761) + (options.agent === 'codex' ? 7 : 0))
  const chance = (p: number) => random() < p
  const between = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1))
  const claude = options.agent === 'claude'
  const loss = options.hookLoss ?? 0
  const steps: SimStep[] = []
  const features = new Set<string>()

  // ── What the session is doing ──────────────────────────────────────────────────────────────────────────────────────
  let now = 0
  let callNo = 0
  let agentNo = 0
  let mainBusy = false
  let errorShown = false
  let exited = false
  let codexStarted = false
  /** Bumped by every turn and every abort: foreground subagents of an older turn stop. */
  let turnGen = 0
  /** Running background subagents (they do not make the session busy, PRD §3.1). */
  let background = 0
  const dialogs: Dialog[] = []
  let lastTurnEnd = -1
  let lastTruth: Truth | null = null
  let lastTitle = ''
  let lastScreen = ''
  let frame = 0

  const hook = (name: string, payload: Record<string, unknown>) => {
    steps.push({ at: now, kind: 'hook', hook: name, payload: { hook_event_name: name, session_id: `sim-${seed}`, cwd: `/sim/${CODEX_DIR}`, ...payload }, lost: chance(loss) })
  }
  const truth = (): Truth => (exited ? 'exited' : dialogs.length > 0 ? 'needs_you' : mainBusy ? 'running' : errorShown ? 'error' : 'idle')
  const show = (why: string) => {
    const t = truth()
    if (t !== lastTruth) {
      steps.push({ at: now, kind: 'truth', truth: t, why })
      lastTruth = t
    }
    if (exited) return
    const head = dialogs[0]
    let title: string
    let screen: string
    if (claude) {
      title = head || !mainBusy ? SIM_CLAUDE_IDLE_TITLE : (CLAUDE_BUSY_TITLES[frame % 2] as string)
      screen = head ? (head.kind === 'question' ? SIM_SCREEN.question : SIM_SCREEN.dialog) : mainBusy ? SIM_SCREEN.busy : SIM_SCREEN.idle
    } else {
      title = head ? (CODEX_ACTION_TITLES[frame % 2] as string) : mainBusy ? (CODEX_BUSY_TITLES[frame % 3] as string) : CODEX_DIR
      screen = head ? SIM_SCREEN.codexDialog : mainBusy ? SIM_SCREEN.codexBusy : SIM_SCREEN.codexIdle
    }
    if (title !== lastTitle) {
      steps.push({ at: now, kind: 'title', title })
      lastTitle = title
    }
    if (screen !== lastScreen) {
      steps.push({ at: now, kind: 'screen', text: screen })
      lastScreen = screen
    }
  }

  // ── Scheduler ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const agenda: { at: number; seq: number; run: () => void }[] = []
  let seq = 0
  const later = (ms: number, run: () => void) => {
    agenda.push({ at: now + Math.max(1, ms), seq: seq++, run })
    agenda.sort((a, b) => a.at - b.at || a.seq - b.seq)
  }
  const resume = (actor: Actor, value?: Decision) => {
    if (exited) return
    const next = actor.next(value)
    if (next.done) return
    const wait = next.value
    if ('sleep' in wait) {
      later(wait.sleep, () => resume(actor))
      return
    }
    dialogs.push({ ...wait.ask, actor })
    if (dialogs.length === 1) showHead()
    show('dialog')
  }

  /** The oldest dialog is on screen: the user answers it after a while; Claude nags after 6 s. */
  const showHead = () => {
    const head = dialogs[0]
    if (!head) return
    const answerIn = chance(0.1) ? between(60_000, 240_000) : between(1_000, 45_000)
    if (claude && head.kind === 'permission' && answerIn > PERMISSION_NOTIFY_MS) {
      later(PERMISSION_NOTIFY_MS, () => {
        if (dialogs[0] === head) hook('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' })
      })
    }
    later(answerIn, () => {
      if (dialogs[0] !== head) return
      dialogs.shift()
      if (head.decision === 'deny' && head.main) {
        // Denied without feedback on the main thread (Esc on Codex's dialog): the turn ends, with no hook at all.
        abortTurn('denied')
        return
      }
      showHead()
      show(`answered ${head.decision}`)
      resume(head.actor, head.decision)
    })
  }

  /** Esc or a denial: the turn ends with no Stop; its dialogs go away, a background agent's are denied. */
  const abortTurn = (why: string) => {
    mainBusy = false
    turnGen++
    lastTurnEnd = now
    const dropped = dialogs.splice(0)
    show(why)
    for (const dialog of dropped) if (!dialog.main) resume(dialog.actor, 'deny')
    if (dialogs.length > 0) showHead()
    if (claude) idleNotification(now)
  }

  /** idle_prompt: 60 s after a turn, if nothing ran, asked or worked in the background since. */
  const idleNotification = (since: number) => {
    later(IDLE_NOTIFY_MS, () => {
      if (exited || mainBusy || dialogs.length > 0 || lastTurnEnd !== since) return
      if (background > 0) {
        later(5_000, () => idleNotification(since))
        return
      }
      hook('Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })
    })
  }

  // ── Pieces of a turn ────────────────────────────────────────────────────────────────────────────────────────────────
  const call = (tool: string, input: Record<string, unknown>, agentId?: string) => ({
    tool_name: tool,
    tool_input: input,
    tool_use_id: `toolu_${callNo++}`,
    ...(agentId ? { agent_id: agentId, agent_type: 'general-purpose' } : {})
  })
  const request = (c: ReturnType<typeof call>) => {
    const { tool_use_id: _id, ...rest } = c
    return claude ? { ...rest, permission_suggestions: [] } : rest
  }
  const randomCall = (): { tool: string; input: Record<string, unknown> } => {
    const n = callNo
    if (!claude) {
      return chance(0.3)
        ? { tool: 'apply_patch', input: { command: `*** Begin Patch\n*** Update File: src/f${n}.ts\n@@\n-a\n+b\n*** End Patch` } }
        : { tool: 'Bash', input: { command: `pnpm test --filter p${n}` } }
    }
    const r = random()
    if (r < 0.35) return { tool: 'Bash', input: { command: `pnpm test --filter p${n}`, description: 'run tests' } }
    if (r < 0.6) return { tool: 'Edit', input: { file_path: `/sim/src/f${n}.ts`, old_string: 'a', new_string: 'b' } }
    if (r < 0.8) return { tool: 'Read', input: { file_path: `/sim/src/f${n}.ts` } }
    return { tool: 'Grep', input: { pattern: `p${n}` } }
  }
  const decide = (): Decision => (chance(0.8) ? 'approve' : !claude || chance(0.5) ? 'deny' : 'deny-feedback')

  /** One tool call of `agentId` (the main thread when absent), maybe asking first. */
  function* toolCall(agentId: string | undefined, askChance: number): Task<'ok' | 'aborted' | 'denied'> {
    const { tool, input } = randomCall()
    const c = call(tool, input, agentId)
    hook('PreToolUse', c)
    yield { sleep: between(15, 60) }
    if (chance(askChance)) {
      features.add(agentId ? 'subagent-ask' : 'ask')
      hook('PermissionRequest', request(c))
      const decision = yield { ask: { kind: 'permission', decision: decide(), main: !agentId } }
      if (decision !== 'approve') return 'denied'
    }
    yield { sleep: chance(0.15) ? between(5_000, 40_000) : between(100, 3_000) }
    if (!agentId && chance(0.03)) {
      features.add('interrupt')
      if (claude) hook('PostToolUseFailure', { ...c, error: 'Interrupted', is_interrupt: true })
      abortTurn('esc')
      return 'aborted'
    }
    if (claude && chance(0.05)) hook('PostToolUseFailure', { ...c, error: 'exit code 1', is_interrupt: false })
    else hook('PostToolUse', { ...c, tool_response: claude ? { stdout: 'ok' } : 'ok' })
    return 'ok'
  }

  /** A subagent: a few tool calls, some asking; carries on after a denial. A foreground one stops with its turn. */
  function* subagent(agentId: string, calls: number, foreground: boolean, done: () => void): Actor {
    const gen = turnGen
    const cancelled = () => foreground && gen !== turnGen
    for (let i = 0; i < calls && !cancelled(); i++) {
      yield { sleep: between(800, 6_000) }
      if (cancelled()) break
      yield* toolCall(agentId, foreground ? 0.1 : 0.15)
    }
    if (!cancelled()) {
      yield { sleep: between(200, 2_000) }
      hook('SubagentStop', { agent_id: agentId, agent_type: 'general-purpose', stop_hook_active: false, last_assistant_message: '完成' })
    }
    done()
  }

  /** Two calls of one batch that both ask (two WebFetch to new hosts): two dialogs queue up. */
  function* parallelAsks(): Task<'ok' | 'aborted'> {
    features.add('parallel-asks')
    const gen = turnGen
    const calls = [call('WebFetch', { url: `https://a${callNo}.example`, prompt: 'x' }), call('WebFetch', { url: `https://b${callNo}.example`, prompt: 'x' })]
    for (const c of calls) hook('PreToolUse', c)
    yield { sleep: between(20, 80) }
    for (const c of calls) hook('PermissionRequest', request(c))
    let remaining = calls.length
    for (const c of calls) {
      resume(
        (function* (): Actor {
          const d = yield { ask: { kind: 'permission', decision: chance(0.85) ? 'approve' : 'deny', main: true } }
          if (d === 'approve') {
            yield { sleep: between(200, 3_000) }
            if (gen === turnGen) hook('PostToolUse', { ...c, tool_response: { code: 200 } })
          }
          remaining -= 1
        })()
      )
    }
    while (remaining > 0 && gen === turnGen) yield { sleep: 250 }
    return gen === turnGen ? 'ok' : 'aborted'
  }

  /** A main-thread turn: tool calls, maybe subagents, background work, then Stop (or not). */
  function* turn(system: boolean): Actor {
    const gen = ++turnGen
    mainBusy = true
    errorShown = false
    frame++
    if (claude) hook('UserPromptSubmit', { prompt: system ? '<task-notification>' : '改一下', ...(system ? { source: 'system' } : {}) })
    else {
      if (!codexStarted) hook('SessionStart', { source: 'startup' })
      codexStarted = true
      hook('UserPromptSubmit', { prompt: '改一下' })
    }
    show(system ? 'woken by a background agent' : 'prompt')
    const live = () => gen === turnGen
    const stepsInTurn = system ? between(0, 2) : between(1, 7)
    for (let i = 0; i < stepsInTurn && live(); i++) {
      yield { sleep: between(800, 8_000) }
      if (!live()) return
      const r = random()
      if (claude && r < 0.05) {
        if ((yield* parallelAsks()) === 'aborted') return
      } else if (claude && r < 0.09) {
        features.add('question')
        const q = call('AskUserQuestion', { questions: [{ question: '用哪个库？', header: '库', multiSelect: false, options: [{ label: 'zod' }, { label: 'valibot' }] }] })
        hook('PreToolUse', q)
        hook('PermissionRequest', request(q))
        yield { ask: { kind: 'question', decision: 'approve', main: true } }
        if (!live()) return
        hook('PostToolUse', { ...q, tool_response: { answers: { 用哪个库: 'zod' } } })
      } else if (claude && r < 0.11) {
        features.add('plan')
        const p = call('ExitPlanMode', { plan: '1. 改 a\n2. 改 b' })
        hook('PreToolUse', p)
        hook('PermissionRequest', request(p))
        const d = yield { ask: { kind: 'permission', decision: chance(0.9) ? 'approve' : 'deny-feedback', main: true } }
        if (!live()) return
        if (d === 'approve') hook('PostToolUse', { ...p, tool_response: { plan: 'ok' } })
      } else if (claude && r < 0.19) {
        // Foreground Task: subagents in parallel; the main thread waits for all of them.
        features.add('subagents')
        const task = call('Task', { description: '并行调查', prompt: '…', subagent_type: 'general-purpose' })
        hook('PreToolUse', task)
        let running = between(1, 3)
        for (let k = running; k > 0; k--) resume(subagent(`agent-${seed}-${agentNo++}`, between(1, 4), true, () => (running -= 1)))
        while (running > 0 && live()) yield { sleep: 250 }
        if (!live()) return
        hook('PostToolUse', { ...task, tool_response: { content: [{ type: 'text', text: '完成' }] } })
      } else if (claude && r < 0.23) {
        features.add('background-agent')
        const task = call('Task', { description: '后台检查', prompt: '…', subagent_type: 'general-purpose', run_in_background: true })
        hook('PreToolUse', task)
        yield { sleep: between(30, 200) }
        hook('PostToolUse', { ...task, tool_response: { status: 'async_launched' } })
        background += 1
        resume(
          subagent(`agent-${seed}-${agentNo++}`, between(2, 8), false, () => {
            background -= 1
            // The finished task wakes an idle main thread; a busy one reads it within its turn.
            if (!mainBusy && dialogs.length === 0 && !exited) {
              features.add('wake')
              resume(turn(true))
            }
          })
        )
      } else if (r < 0.26) {
        features.add('background-bash')
        const bash = call('Bash', { command: 'pnpm dev', run_in_background: true })
        hook('PreToolUse', bash)
        yield { sleep: between(100, 400) }
        hook('PostToolUse', { ...bash, tool_response: { backgroundTaskId: 'b1' } })
      } else if (claude && r < 0.28) {
        features.add('compact')
        hook('PreCompact', { trigger: 'auto', custom_instructions: null })
        yield { sleep: between(2_000, 10_000) }
        hook('SessionStart', { source: 'compact' })
      } else {
        const result = yield* toolCall(undefined, options.auto ? 0.03 : 0.15)
        if (result === 'aborted' || !live()) return
      }
    }
    if (!live()) return
    yield { sleep: between(500, 6_000) }
    if (!live()) return
    if (claude && chance(0.05)) {
      features.add('api-error')
      errorShown = true
      hook('StopFailure', { error: 'rate_limit', last_assistant_message: 'API Error: 429' })
    } else if (!claude && chance(0.05)) {
      // A failed model request: Codex sends nothing at all.
      features.add('failed-request')
    } else {
      hook('Stop', { stop_hook_active: false, last_assistant_message: '改好了。', ...(claude ? { background_tasks: [], session_crons: [] } : {}) })
    }
    mainBusy = false
    lastTurnEnd = now
    show('stop')
    if (claude) idleNotification(now)
  }

  /** Agent teams: a teammate asks the idle lead for permission (no PermissionRequest in the lead; PRD §6.6). */
  function* teammate(name: string): Actor {
    features.add('team')
    hook('TaskCreated', { task_id: `t${callNo}`, task_subject: '复查', task_description: '…', teammate_name: name, team_name: 'sim' })
    yield { sleep: between(2_000, 20_000) }
    if (mainBusy) return
    hook('Notification', { notification_type: 'worker_permission_prompt', message: `${name} needs permission for Bash` })
    yield { ask: { kind: 'permission', decision: chance(0.85) ? 'approve' : 'deny', main: false } }
    yield { sleep: between(1_000, 10_000) }
    hook('TeammateIdle', { teammate_name: name, team_name: 'sim' })
    hook('TaskCompleted', { task_id: `t${callNo}`, task_subject: '复查', teammate_name: name, team_name: 'sim' })
  }

  /** The person at the keyboard: prompts, waits, now and then /clear; quits at the end. */
  function* user(): Actor {
    if (claude) hook('SessionStart', { source: 'startup' })
    show('launch')
    const turns = options.turns ?? 4
    for (let i = 0; i < turns; i++) {
      if (claude && i > 0 && chance(0.12) && background === 0) resume(teammate(`teammate-${agentNo++}`))
      yield { sleep: chance(0.1) ? between(120_000, 300_000) : between(2_000, 60_000) }
      while (mainBusy || dialogs.length > 0) yield { sleep: 1_000 }
      if (claude && chance(0.08)) {
        features.add('clear')
        hook('SessionEnd', { reason: 'clear' })
        hook('SessionStart', { source: 'clear' })
        yield { sleep: 500 }
      }
      resume(turn(false))
      yield { sleep: 1_000 }
      while (mainBusy) yield { sleep: 1_000 }
    }
    yield { sleep: between(5_000, 90_000) }
    while (dialogs.length > 0 || background > 0 || mainBusy) yield { sleep: 1_000 }
    if (claude) hook('SessionEnd', { reason: 'prompt_input_exit' })
    exited = true
    steps.push({ at: now, kind: 'exit', code: 0 })
    show('exit')
  }

  // Busy titles animate (Claude's spinner, Codex's braille and its blinking Action Required).
  const animate = () => {
    if (exited) return
    if (mainBusy || dialogs.length > 0) {
      frame++
      show('frame')
    }
    later(1_000, animate)
  }

  resume(user())
  later(1_000, animate)
  while (agenda.length > 0 && !exited && now < MAX_SIM_MS) {
    const next = agenda.shift() as (typeof agenda)[number]
    now = next.at
    next.run()
  }
  return { agent: options.agent, steps: steps.sort((a, b) => a.at - b.at), end: now + 1_000, features }
}
