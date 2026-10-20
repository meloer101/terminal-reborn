// Status under load, end to end (PRD §3.1, §1.3 "状态卡死 0 次"; ROADMAP 外部需求 c#1027 / c#2322 / o#13600).
// Several agent sessions replay seeded simulated sessions (src/shared/agent-sim.ts) — parallel permission dialogs,
// subagents and background agents (`agent_id`), agent-team prompts, questions, plan approval, Esc, API errors, lost
// hooks — through e2e/status-agent.mjs, a fake `claude` / `codex` that runs Wavi's real per-launch hooks and draws the
// titles and screens the CLI would. Every 500 ms the sidebar's status of every session is compared with what its
// simulated agent really does. The fake Codex has no hooks (Wavi cannot pin its hook trust), so it is titles only.
//
// Opt-in, a quarter of an hour:  TR_STATUS_STRESS=1 npx playwright test e2e/status-stress.spec.ts
// Knobs: TR_STATUS_STRESS_CLAUDE (6) · TR_STATUS_STRESS_CODEX (2) · TR_STATUS_STRESS_TURNS (3) ·
// TR_STATUS_STRESS_LOSS (share of Claude hooks lost, 0.02) · TR_STATUS_STRESS_SEED (1) · TR_STATUS_STRESS_OUT
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { simulateSession, type SimScript, type Truth } from '../src/shared/agent-sim'
import { STATUS_LABEL } from '../src/shared/session-status'
import type { SessionStatus } from '../src/shared/types'
import { outerClaudeEnv } from './fake-claude'
import { launchApp, setWindowSize } from './launch'

const AGENT = resolve('e2e/status-agent.mjs')
const OUT = process.env.TR_STATUS_STRESS_OUT ?? join(process.cwd(), 'test-results', 'status-stress')
const CLAUDE = Number(process.env.TR_STATUS_STRESS_CLAUDE ?? 6)
const CODEX = Number(process.env.TR_STATUS_STRESS_CODEX ?? 2)
const TURNS = Number(process.env.TR_STATUS_STRESS_TURNS ?? 3)
const LOSS = Number(process.env.TR_STATUS_STRESS_LOSS ?? 0.02)
const SEED = Number(process.env.TR_STATUS_STRESS_SEED ?? 1)
/** The unit replay's lag bound (src/main/hooks/status-sim.test.ts) plus the hook relay, IPC, a poll and slack. */
const LAG_MS = 15_000
const POLL_MS = 500

const ALLOWED: Record<Truth, SessionStatus[]> = {
  running: ['running'],
  needs_you: ['needs_you'],
  idle: ['idle', 'done_unread'],
  error: ['error'],
  exited: ['exited', 'error']
}
const STATUS_OF = new Map<string, SessionStatus>(Object.entries(STATUS_LABEL).map(([status, label]) => [label, status as SessionStatus]))

test.skip(!process.env.TR_STATUS_STRESS, 'opt-in status stress run: TR_STATUS_STRESS=1')

interface Run {
  id: string
  dir: string
  script: SimScript
  truths: { at: number; truth: Truth; why: string }[]
}

function truthAt(run: Run, ms: number): Truth {
  let truth: Truth = 'idle'
  for (const t of run.truths) {
    if (t.at > ms) break
    truth = t.truth
  }
  return truth
}

test('the sidebar follows simulated Claude Code and Codex sessions', async () => {
  const runs: Run[] = []
  for (let i = 0; i < CLAUDE + CODEX; i++) {
    const agent = i < CLAUDE ? 'claude' : 'codex'
    const script = simulateSession(SEED * 1000 + i, { agent, turns: TURNS, hookLoss: agent === 'claude' ? LOSS : 1 })
    runs.push({ id: `s-stress-${i}`, dir: '', script, truths: script.steps.flatMap((s) => (s.kind === 'truth' ? [{ at: s.at, truth: s.truth, why: s.why }] : [])) })
  }
  const longest = Math.max(...runs.map((r) => r.script.end))
  test.setTimeout(longest + 5 * 60_000)

  mkdirSync(OUT, { recursive: true })
  const root = mkdtempSync(join(tmpdir(), 'tr-status-stress-'))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  const profile = join(root, 'profile')
  for (const dir of [bin, zdot, profile]) mkdirSync(dir, { recursive: true })
  for (const agent of ['claude', 'codex']) {
    writeFileSync(join(bin, agent), `#!/bin/sh\nexec '${process.execPath}' '${AGENT}' ${agent} "$@"\n`)
    chmodSync(join(bin, agent), 0o755)
  }
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\n`)
  const projects: object[] = []
  const worktrees: object[] = []
  for (const [i, run] of runs.entries()) {
    run.dir = join(root, `proj-${i}`)
    mkdirSync(run.dir)
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: run.dir })
    writeFileSync(join(run.dir, '.sim-script.json'), JSON.stringify({ steps: run.script.steps.filter((s) => s.kind !== 'truth') }))
    projects.push({ id: `p-${i}`, name: `状态压测 ${i}`, rootPath: run.dir })
    worktrees.push({ id: `w-${i}`, projectId: `p-${i}`, branch: 'main', path: run.dir, isMain: true })
  }
  writeFileSync(
    join(profile, 'workspace.json'),
    JSON.stringify({
      version: 2,
      projects,
      worktrees,
      sessions: runs.map((run, i) => ({ id: run.id, worktreeId: `w-${i}`, kind: run.script.agent, title: `模拟 ${i + 1}`, startedAt: 1, lastActivityAt: 1 })),
      activeSessionId: null,
      sidebarCollapsed: false,
      rightPanel: null,
      drafts: {}
    })
  )

  const app = await launchApp({ ...outerClaudeEnv(), ZDOTDIR: zdot, SHELL: '/bin/zsh' }, { userDataDir: profile })
  try {
    const page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    const rows = page.locator('[data-region="sidebar"] [data-session-id]')
    await expect(rows).toHaveCount(runs.length, { timeout: 30_000 })
    // Terminals spawn on first view: show each session once; its agent's clock starts then.
    for (const run of runs) {
      await page.locator(`[data-region="sidebar"] [data-session-id="${run.id}"]`).click()
      await expect.poll(() => existsSync(join(run.dir, '.sim-start')), { timeout: 30_000 }).toBe(true)
    }
    // Nobody is looking at any of them from now on (an unread reply stays unread).
    await page.locator('[data-region="sidebar"] nav button', { hasText: '总览' }).click()
    const starts = new Map(runs.map((run) => [run.id, Number(readFileSync(join(run.dir, '.sim-start'), 'utf8'))]))

    const wrong = new Map<string, { since: number; truth: Truth; status: SessionStatus } | null>()
    const stretches: { id: string; ms: number; at: number; truth: Truth; status: SessionStatus }[] = []
    const end = Math.max(...runs.map((r) => (starts.get(r.id) ?? 0) + r.script.end)) + 5_000
    while (Date.now() < end) {
      const shown = await page.evaluate(() =>
        [...document.querySelectorAll('[data-region="sidebar"] [data-session-id]')].map((row) => ({
          id: row.getAttribute('data-session-id') ?? '',
          label: row.querySelector('[role="img"]')?.getAttribute('aria-label') ?? ''
        }))
      )
      const now = Date.now()
      for (const { id, label } of shown) {
        const run = runs.find((r) => r.id === id)
        const start = starts.get(id)
        const status = STATUS_OF.get(label)
        if (!run || start === undefined || !status) continue
        const ms = now - start
        // Its first seconds are the launch (phase starting); after its exit it may be gone or stay exited.
        if (ms < 3_000 || ms > run.script.end) continue
        const truth = truthAt(run, ms)
        const ok = ALLOWED[truth].includes(status)
        const open = wrong.get(id)
        if (!ok && !open) wrong.set(id, { since: ms, truth, status })
        else if (ok && open) {
          stretches.push({ id, ms: ms - open.since, at: open.since, truth: open.truth, status: open.status })
          wrong.set(id, null)
        }
      }
      await page.waitForTimeout(POLL_MS)
    }
    for (const [id, open] of wrong) {
      const run = runs.find((r) => r.id === id)
      if (open && run) stretches.push({ id, ms: run.script.end - open.since, at: open.since, truth: open.truth, status: open.status })
    }

    const worst = stretches.reduce((a, b) => (b.ms > a.ms ? b : a), { id: '-', ms: 0, at: 0, truth: 'idle' as Truth, status: 'idle' as SessionStatus })
    const simulated = runs.reduce((a, r) => a + r.script.end, 0)
    const wrongMs = stretches.filter((s) => s.ms > 1_000).reduce((a, s) => a + s.ms, 0)
    const summary = {
      sessions: { claude: CLAUDE, codex: CODEX },
      turns: TURNS,
      hookLoss: LOSS,
      minutesSimulated: Math.round(simulated / 60_000),
      wrongOver1sShare: Math.round((wrongMs / simulated) * 10_000) / 100,
      worst,
      features: [...new Set(runs.flatMap((r) => [...r.script.features]))].sort(),
      stretches: stretches.filter((s) => s.ms > 1_000)
    }
    writeFileSync(join(OUT, 'status-stress.json'), JSON.stringify(summary, null, 2))
    console.log(`status stress: ${summary.minutesSimulated} session-minutes; wrong > 1 s for ${summary.wrongOver1sShare}% of the time; worst ${worst.ms} ms (${worst.id}: ${worst.status} while really ${worst.truth} at ${Math.round(worst.at / 1000)} s)`)
    expect(worst.ms, JSON.stringify(worst)).toBeLessThanOrEqual(LAG_MS)
  } finally {
    await app.close().catch(() => {})
  }
})
