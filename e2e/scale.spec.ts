// Scale baseline (ROADMAP D1, PRD §1.3: cold start ≤ 2 s, < 16 ms input at 10 sessions, < 1.5 GB resident): cold
// start, 10 and 20 agent sessions idle and streaming, input latency, and a soak that samples memory and CPU for hours.
// The agents are e2e/scale-agent.mjs: a fake `claude` that runs Wavi's real per-launch hooks and statusLine, draws like
// an agent TUI and writes a transcript, so the hook bridge, status, transcript meter and terminals all carry load.
//
// Opt-in:
//   TR_SCALE=1 npx playwright test e2e/scale.spec.ts                          cold start, 10 and 20 sessions (~10 min)
//   TR_SCALE=1 TR_SCALE_SOAK_MIN=480 npx playwright test e2e/scale.spec.ts -g soak    the 8-hour soak
// Knobs: TR_SCALE_SESSIONS (10,20) · TR_SCALE_LPS (reply lines per second per working session, 20) ·
// TR_SCALE_SOAK_SESSIONS (20) · TR_SCALE_SOAK_SAMPLE_S (60) · TR_SCALE_OUT (evidence; default test-results/scale) ·
// TR_SCALE_APP (an app folder to launch instead of this checkout, e.g. a frozen copy of out/ for a soak that must not
// pick up rebuilds). Memory is the sum of the app's processes (Electron's working set) plus the pty daemon's RSS, and
// macOS phys_footprint of the same processes (what Activity Monitor shows); agents and their shells are not counted.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { outerClaudeEnv } from './fake-claude'
import { launchApp, setWindowSize } from './launch'

const AGENT = resolve('e2e/scale-agent.mjs')
const OUT = process.env.TR_SCALE_OUT ?? join(process.cwd(), 'test-results', 'scale')
const APP_DIR = process.env.TR_SCALE_APP
const SIZES = (process.env.TR_SCALE_SESSIONS ?? '10,20').split(',').map(Number).filter((n) => n > 0)
const LPS = Number(process.env.TR_SCALE_LPS ?? 20)
const SOAK_MIN = Number(process.env.TR_SCALE_SOAK_MIN ?? 0)
const SOAK_SESSIONS = Number(process.env.TR_SCALE_SOAK_SESSIONS ?? 20)
const SOAK_SAMPLE_MS = Number(process.env.TR_SCALE_SOAK_SAMPLE_S ?? 60) * 1000
const LATENCY_KEYS = 40
/** TR_SCALE_PROFILE=1: a renderer CPU profile (and long tasks) of the streaming phase, saved to OUT, for chasing slow keys. */
const PROFILE = Boolean(process.env.TR_SCALE_PROFILE)
const PER_PROJECT = 5

interface Globals {
  /** Screen reading with the real workspace (`__TR_E2E__` would swap in the fixture sessions). */
  __TR_TERMINAL_PROBE__: boolean
  __trTerminals: { readScreen(sessionId: string, scrollbackLines?: number): string }
  tr: { pty: { write(id: string, data: string): void } }
}

test.describe.configure({ mode: 'serial' })
test.skip(!process.env.TR_SCALE, 'opt-in scale run: TR_SCALE=1')

/** A throwaway world: the fake `claude` first on the login shell's PATH, git projects with worktrees, a profile. */
function world(prefix: string, sessions: number) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  const claudeConfig = join(root, 'claude-config')
  const profile = join(root, 'profile')
  for (const dir of [bin, zdot, claudeConfig, profile]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec '${process.execPath}' '${AGENT}' "$@"\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\n`)
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' })

  const projects: { id: string; name: string; rootPath: string }[] = []
  const worktrees: { id: string; projectId: string; branch: string; path: string; isMain: boolean }[] = []
  const ids: string[] = []
  for (let i = 0; i < sessions; i++) {
    const p = Math.floor(i / PER_PROJECT)
    const projectRoot = join(root, `proj-${p}`)
    if (i % PER_PROJECT === 0) {
      mkdirSync(join(projectRoot, 'src'), { recursive: true })
      writeFileSync(join(projectRoot, 'src', 'index.ts'), 'export const a = 1\n')
      git(projectRoot, 'init', '-q', '-b', 'main')
      git(projectRoot, 'add', '.')
      git(projectRoot, 'commit', '-qm', 'init')
      projects.push({ id: `p-${p}`, name: `压测项目-${p}`, rootPath: projectRoot })
    }
    const main = i % PER_PROJECT === 0
    const path = main ? projectRoot : join(root, `proj-${p}-wt-${i}`)
    if (!main) git(projectRoot, 'worktree', 'add', '-q', path, '-b', `scale/wt-${i}`)
    worktrees.push({ id: `w-${i}`, projectId: `p-${p}`, branch: main ? 'main' : `scale/wt-${i}`, path, isMain: main })
    ids.push(`s-scale-${i}`)
  }
  writeFileSync(
    join(profile, 'workspace.json'),
    JSON.stringify({
      version: 2,
      projects,
      worktrees,
      sessions: ids.map((id, i) => ({ id, worktreeId: `w-${i}`, kind: 'claude', title: `压测会话 ${i + 1}`, startedAt: 1, lastActivityAt: 1 })),
      activeSessionId: null,
      sidebarCollapsed: false,
      rightPanel: null,
      drafts: {}
    })
  )
  const env = { ...outerClaudeEnv(), ZDOTDIR: zdot, SHELL: '/bin/zsh', CLAUDE_CONFIG_DIR: claudeConfig, TR_SCALE_LPS: String(LPS) }
  return { root, profile, env, ids }
}

/** One running app with its sessions' agents up. */
class Rig {
  app!: ElectronApplication
  page!: Page
  private keysTyped = new Map<string, number>()
  private lastCpuAt = 0

  constructor(
    readonly profile: string,
    readonly env: Record<string, string | undefined>,
    readonly ids: string[]
  ) {}

  async launch(extraEnv: Record<string, string | undefined> = {}): Promise<number> {
    const t0 = Date.now()
    this.app = await launchApp({ ...this.env, ...extraEnv }, { userDataDir: this.profile, ...(APP_DIR ? { appDir: APP_DIR } : {}) })
    this.page = await this.app.firstWindow()
    await expect(this.page.locator('[data-region="sidebar"] [data-session-id]')).toHaveCount(this.ids.length, { timeout: 60_000 })
    return Date.now() - t0
  }

  /** Screen reading (`__trTerminals`) needs its flag before the page loads. */
  async enableHooks(): Promise<void> {
    await setWindowSize(this.app, this.page, 1440, 900)
    await this.page.addInitScript(() => {
      ;(globalThis as unknown as Globals).__TR_TERMINAL_PROBE__ = true
    })
    await this.page.reload()
    await this.page.waitForFunction(() => Boolean((globalThis as unknown as { __trTerminals?: unknown }).__trTerminals))
    await expect(this.page.locator('[data-region="sidebar"] [data-session-id]')).toHaveCount(this.ids.length, { timeout: 30_000 })
  }

  screen(id: string, scrollback = 0): Promise<string> {
    return this.page.evaluate(([sid, n]) => (globalThis as unknown as Globals).__trTerminals.readScreen(sid as string, n as number), [id, scrollback] as const)
  }

  write(id: string, data: string): Promise<void> {
    return this.page.evaluate(([sid, d]) => (globalThis as unknown as Globals).tr.pty.write(sid as string, d as string), [id, data])
  }

  /** Clicks the session in the sidebar, as a person would. */
  async activate(id: string): Promise<void> {
    await this.page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`).click()
    await expect(this.page.locator(`[data-region="terminal"] [data-session-id="${id}"]`)).toBeVisible()
  }

  async overview(): Promise<void> {
    await this.page.locator('[data-region="sidebar"] nav button', { hasText: '总览' }).click()
  }

  /** Terminals spawn on first view: shows every session once and waits for its agent. */
  async startAll(): Promise<void> {
    for (const id of this.ids) {
      await this.activate(id)
      await expect.poll(() => this.screen(id, 200), { timeout: 30_000 }).toContain('@@ready@@')
    }
  }

  async mode(ids: readonly string[], command: 'w' | 'c' | 'i'): Promise<void> {
    for (const id of ids) await this.write(id, command)
  }

  /** The app's processes plus the daemon: resident memory by process type, phys_footprint, heaps. */
  async memory() {
    const metrics = await this.app.evaluate(({ app }) => app.getAppMetrics())
    const byType: Record<string, number> = {}
    for (const m of metrics) byType[m.type] = (byType[m.type] ?? 0) + m.memory.workingSetSize / 1024
    const daemonPid = this.daemonPid()
    const daemon = daemonPid ? Number(execFileSync('ps', ['-o', 'rss=', '-p', String(daemonPid)], { encoding: 'utf8' }).trim()) / 1024 : 0
    const pids = [...metrics.map((m) => m.pid), ...(daemonPid ? [daemonPid] : [])]
    let footprint = Number.NaN
    const footprintByType: Record<string, number> = {}
    try {
      const text = execFileSync('footprint', ['-f', 'bytes', ...pids.map(String)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      footprint = Number(/Summary Footprint: (\d+) B/.exec(text)?.[1] ?? /Footprint: (\d+) B/.exec(text)?.[1]) / 1048576
      // Per process: `<name> [<pid>]: 64-bit    Footprint: <n> B`.
      for (const [, pid, bytes] of text.matchAll(/\[(\d+)\]: \S+\s+Footprint: (\d+) B/g)) {
        const type = Number(pid) === daemonPid ? 'daemon' : (metrics.find((m) => m.pid === Number(pid))?.type ?? 'other')
        footprintByType[type] = Math.round(((footprintByType[type] ?? 0) + Number(bytes) / 1048576) * 10) / 10
      }
    } catch {
      // footprint(1) missing or refused: report NaN.
    }
    const cdp = await this.page.context().newCDPSession(this.page)
    const rendererHeap = ((await cdp.send('Runtime.getHeapUsage')) as { usedSize: number }).usedSize / 1048576
    await cdp.detach()
    const mainHeap = (await this.app.evaluate(() => process.memoryUsage().heapUsed)) / 1048576
    const total = Object.values(byType).reduce((a, b) => a + b, 0) + daemon
    return { total, footprint, footprintByType, byType, daemon, rendererHeap, mainHeap }
  }

  /** Ends the pty daemon and with it every session (after a quit that kept them running). */
  endDaemon(): void {
    try {
      const pid = (JSON.parse(readFileSync(join(this.profile, 'daemon', 'daemon.json'), 'utf8')) as { pid: number }).pid
      process.kill(pid, 'SIGTERM')
    } catch {
      // No daemon left.
    }
  }

  private daemonPid(): number | null {
    const ps = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    const line = ps.split('\n').find((l) => l.includes(join(this.profile, 'daemon')) && l.includes('--socket'))
    return line ? Number(line.trim().split(/\s+/)[0]) : null
  }

  private daemonCpuSeconds(): number {
    const pid = this.daemonPid()
    if (!pid) return 0
    const [m, s] = execFileSync('ps', ['-o', 'time=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(':')
    return Number(m) * 60 + Number(s)
  }

  /** CPU % by process type (and the daemon) averaged over `ms`. */
  async cpu(ms: number): Promise<Record<string, number>> {
    await this.app.evaluate(({ app }) => app.getAppMetrics())
    const daemonBefore = this.daemonCpuSeconds()
    const t0 = Date.now()
    await this.page.waitForTimeout(ms)
    const metrics = await this.app.evaluate(({ app }) => app.getAppMetrics())
    const byType: Record<string, number> = {}
    for (const m of metrics) byType[m.type] = Math.round(((byType[m.type] ?? 0) + m.cpu.percentCPUUsage) * 10) / 10
    byType.daemon = Math.round(((this.daemonCpuSeconds() - daemonBefore) / ((Date.now() - t0) / 1000)) * 1000) / 10
    this.lastCpuAt = Date.now()
    return byType
  }

  /** Since the previous call: CPU % by process type and the daemon (for the soak, one call per sample). */
  async cpuSinceLast(daemonBefore: number): Promise<{ byType: Record<string, number>; daemonSeconds: number }> {
    const metrics = await this.app.evaluate(({ app }) => app.getAppMetrics())
    const seconds = this.daemonCpuSeconds()
    const elapsed = (Date.now() - this.lastCpuAt) / 1000
    this.lastCpuAt = Date.now()
    const byType: Record<string, number> = {}
    for (const m of metrics) byType[m.type] = Math.round(((byType[m.type] ?? 0) + m.cpu.percentCPUUsage) * 10) / 10
    byType.daemon = elapsed > 0 ? Math.round(((seconds - daemonBefore) / elapsed) * 1000) / 10 : 0
    return { byType, daemonSeconds: seconds }
  }

  daemonSeconds(): number {
    return this.daemonCpuSeconds()
  }

  /** Types `k` into the shown session; each comes back as `@@key n@@`. Key-down → first frame showing it, in ms. */
  async latency(id: string): Promise<{ p50: number; p95: number; max: number; lost: number }> {
    await this.page.locator(`[data-region="terminal"] [data-session-id="${id}"]`).click()
    const base = this.keysTyped.get(id) ?? 0
    this.keysTyped.set(id, base + LATENCY_KEYS)
    await this.page.evaluate(([sid, from]) => {
      const w = globalThis as unknown as { __lat?: { down: number[]; seen: Map<number, number>; stop: boolean; base: number } } & Globals
      const lat = { down: [] as number[], seen: new Map<number, number>(), stop: false, base: from as number }
      const keys = (): number[] => [...w.__trTerminals.readScreen(sid as string, 0).matchAll(/@@key (\d+)@@/g)].map((m) => Number(m[1]))
      w.__lat = lat
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'k') lat.down.push(performance.now())
      }
      document.addEventListener('keydown', onKey, true)
      let last = lat.base
      const poll = (t: number): void => {
        const max = Math.max(0, ...keys().filter((n) => n > lat.base))
        while (last < max) lat.seen.set(++last, t)
        if (!lat.stop) requestAnimationFrame(poll)
        else document.removeEventListener('keydown', onKey, true)
      }
      requestAnimationFrame(poll)
    }, [id, base] as const)
    for (let i = 0; i < LATENCY_KEYS; i++) {
      await this.page.keyboard.press('k')
      await this.page.waitForTimeout(120)
    }
    await this.page.waitForTimeout(500)
    const samples = await this.page.evaluate(() => {
      const lat = (globalThis as unknown as { __lat: { down: number[]; seen: Map<number, number>; stop: boolean; base: number } }).__lat
      lat.stop = true
      return lat.down.map((t, i) => (lat.seen.get(lat.base + i + 1) ?? Number.NaN) - t)
    })
    const sorted = samples.filter((s) => Number.isFinite(s)).sort((a, b) => a - b)
    const at = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN)
    return { p50: at(0.5), p95: at(0.95), max: Math.round(sorted.at(-1) ?? Number.NaN), lost: samples.length - sorted.length }
  }

  /** Samples the renderer's main thread (1 ms) and records long tasks until `stop`, which writes `<file>.cpuprofile`. */
  async startProfile(): Promise<{ stop(file: string): Promise<void> }> {
    const cdp = await this.page.context().newCDPSession(this.page)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
    await cdp.send('Profiler.start')
    await this.page.evaluate(() => {
      const g = globalThis as unknown as { __longTasks: { at: number; ms: number }[] }
      g.__longTasks = []
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) g.__longTasks.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) })
      }).observe({ type: 'longtask' })
    })
    return {
      stop: async (file: string) => {
        const { profile } = (await cdp.send('Profiler.stop')) as { profile: unknown }
        await cdp.detach()
        writeFileSync(`${file}.cpuprofile`, JSON.stringify(profile))
        const longTasks = await this.page.evaluate(() => (globalThis as unknown as { __longTasks: { at: number; ms: number }[] }).__longTasks)
        writeFileSync(`${file}-longtasks.json`, JSON.stringify(longTasks))
        console.log(`long tasks: ${longTasks.length}, longest ${Math.max(0, ...longTasks.map((t) => t.ms))} ms`)
      }
    }
  }

  async close(): Promise<void> {
    await this.app?.close().catch(() => {})
  }
}

const mb = (n: number) => `${Math.round(n)} MB`
const summary = (m: Awaited<ReturnType<Rig['memory']>>) =>
  `total ${mb(m.total)} · footprint ${mb(m.footprint)} (${Object.entries(m.byType).map(([k, v]) => `${k} ${mb(v)}`).join(', ')}, daemon ${mb(m.daemon)}) · heap renderer ${mb(m.rendererHeap)} main ${mb(m.mainHeap)}`

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true })
})

test('cold start: empty profile, 20 restored sessions, 20 agents still alive in the daemon', async () => {
  test.setTimeout(10 * 60_000)
  const result: { empty: { wall: number; domContentLoaded: number | null }[]; restored20: number[]; daemon20: number[] } = { empty: [], restored20: [], daemon20: [] }

  // The first launch after a build warms the OS file cache; it is not counted.
  const empty = world('tr-scale-cold-', 0)
  for (const run of [0, 1, 2, 3]) {
    const rig = new Rig(join(empty.root, `profile-${run}`), empty.env, [])
    mkdirSync(rig.profile, { recursive: true })
    const wall = await rig.launch()
    // In-app: main process created → the page's DOMContentLoaded (no Playwright in it).
    const loaded = await rig.page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      return nav ? performance.timeOrigin + nav.domContentLoadedEventEnd : null
    })
    const created = await rig.app.evaluate(() => process.getCreationTime())
    await rig.close()
    if (run === 0) continue
    result.empty.push({ wall, domContentLoaded: loaded && created ? Math.round(loaded - created) : null })
  }

  // 20 sessions restored from workspace.json (not started until viewed).
  const restored = world('tr-scale-cold20-', 20)
  const rig = new Rig(restored.profile, restored.env, restored.ids)
  result.restored20.push(await rig.launch())
  await rig.close()
  result.restored20.push(await rig.launch())

  // The same 20 with their agents running in the pty daemon: quit without ending them, relaunch, reattach all.
  await rig.enableHooks()
  await rig.startAll()
  await rig.app.evaluate(({ app }) => app.quit())
  await rig.app.waitForEvent('close').catch(() => {})
  const alive: number[] = []
  for (let run = 0; run < 2; run++) {
    const relaunch = new Rig(restored.profile, restored.env, restored.ids)
    alive.push(await relaunch.launch({ TR_KILL_SESSIONS_ON_QUIT: undefined }))
    await relaunch.app.evaluate(({ app }) => app.quit())
    await relaunch.app.waitForEvent('close').catch(() => {})
  }
  rig.endDaemon()
  result.daemon20.push(...alive)
  writeFileSync(join(OUT, 'cold-start.json'), JSON.stringify(result, null, 2))
  console.log(`cold start (launch → sidebar with every session, ms): ${JSON.stringify(result)}`)
})

for (const size of SIZES) {
  test(`${size} sessions: memory, CPU and input latency, idle and streaming`, async () => {
    test.setTimeout(10 * 60_000)
    const w = world(`tr-scale-${size}-`, size)
    const rig = new Rig(w.profile, w.env, w.ids)
    try {
      await rig.launch()
      await rig.enableHooks()
      await rig.startAll()
      const focused = w.ids[0]!
      const background = w.ids.slice(1)
      await rig.activate(focused)
      await rig.page.waitForTimeout(5_000)

      const idle = { memory: await rig.memory(), cpu: await rig.cpu(10_000), latency: await rig.latency(focused) }

      await rig.mode(background, 'w')
      await rig.page.waitForTimeout(10_000)
      const loadMemory: Awaited<ReturnType<Rig['memory']>>[] = []
      for (let i = 0; i < 4; i++) loadMemory.push(await rig.memory())
      const cpuLoad = await rig.cpu(10_000)
      const profiler = PROFILE ? await rig.startProfile() : null
      const latencyLoad = await rig.latency(focused)
      if (profiler) await profiler.stop(join(OUT, `sessions-${size}-load`))
      const load = { memory: loadMemory.reduce((a, b) => (b.total > a.total ? b : a)), cpu: cpuLoad, latency: latencyLoad }

      await rig.mode([focused], 'w')
      await rig.page.waitForTimeout(3_000)
      const busy = { latency: await rig.latency(focused), memory: await rig.memory() }
      await rig.mode(w.ids, 'i')

      const result = { sessions: size, linesPerSecondPerWorkingSession: LPS, idle, load, busy }
      writeFileSync(join(OUT, `sessions-${size}.json`), JSON.stringify(result, null, 2))
      console.log(`${size} idle: ${summary(idle.memory)}; cpu ${JSON.stringify(idle.cpu)}; latency p50 ${idle.latency.p50} p95 ${idle.latency.p95} max ${idle.latency.max} ms`)
      console.log(`${size} load (${size - 1} streaming): ${summary(load.memory)}; cpu ${JSON.stringify(load.cpu)}; latency p50 ${load.latency.p50} p95 ${load.latency.p95} max ${load.latency.max} ms`)
      console.log(`${size} busy (shown one streams too): latency p50 ${busy.latency.p50} p95 ${busy.latency.p95} max ${busy.latency.max} ms; ${summary(busy.memory)}`)
      expect(load.latency.lost).toBe(0)
    } finally {
      await rig.close()
      rig.endDaemon()
    }
  })
}

/** Least-squares slope of y over x (per hour when x is in hours). */
function slope(points: { x: number; y: number }[]): number {
  const n = points.length
  if (n < 2) return 0
  const mx = points.reduce((a, p) => a + p.x, 0) / n
  const my = points.reduce((a, p) => a + p.y, 0) / n
  const sxx = points.reduce((a, p) => a + (p.x - mx) ** 2, 0)
  return sxx === 0 ? 0 : points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx
}

test('soak: memory and CPU over hours with agents working in cycles', async () => {
  test.skip(SOAK_MIN <= 0, 'set TR_SCALE_SOAK_MIN')
  test.setTimeout((SOAK_MIN + 15) * 60_000)
  const w = world('tr-scale-soak-', SOAK_SESSIONS)
  const rig = new Rig(w.profile, { ...w.env, TR_SCALE_START: 'cycle' }, w.ids)
  const log = join(OUT, `soak-${SOAK_SESSIONS}.jsonl`)
  writeFileSync(log, '')
  try {
    await rig.launch()
    await rig.enableHooks()
    await rig.startAll()
    const started = Date.now()
    const end = started + SOAK_MIN * 60_000
    let nextSample = started
    let nextSwitch = started
    let nextOverview = started + 10 * 60_000
    let daemonSeconds = rig.daemonSeconds()
    await rig.cpuSinceLast(daemonSeconds)
    let pick = 1
    const samples: { h: number; total: number; footprint: number; renderer: number; main: number; daemon: number; rendererHeap: number; mainHeap: number }[] = []
    // Something outside can end the app (it happened twice, both times with macOS session activity in the system log):
    // the samples so far still make a summary, then the test fails.
    let interrupted: string | null = null
    try {
      while (Date.now() < end) {
        const now = Date.now()
        if (now >= nextSwitch) {
          // Someone hopping between sessions: a different one every 20 s.
          pick = (pick * 7 + 3) % w.ids.length
          await rig.activate(w.ids[pick]!)
          nextSwitch = now + 20_000
        }
        if (now >= nextOverview) {
          await rig.overview()
          await rig.page.waitForTimeout(30_000)
          await rig.activate(w.ids[pick]!)
          nextOverview = now + 10 * 60_000
        }
        if (now >= nextSample) {
          const memory = await rig.memory()
          const cpu = await rig.cpuSinceLast(daemonSeconds)
          daemonSeconds = cpu.daemonSeconds
          const h = (Date.now() - started) / 3_600_000
          const row = { at: new Date().toISOString(), h: Math.round(h * 1000) / 1000, memory, cpu: cpu.byType }
          appendFileSync(log, `${JSON.stringify(row)}\n`)
          samples.push({ h, total: memory.total, footprint: memory.footprint, renderer: memory.byType.Tab ?? 0, main: memory.byType.Browser ?? 0, daemon: memory.daemon, rendererHeap: memory.rendererHeap, mainHeap: memory.mainHeap })
          nextSample = now + SOAK_SAMPLE_MS
        }
        await rig.page.waitForTimeout(1_000)
      }
    } catch (error) {
      interrupted = error instanceof Error ? error.message.split('\n')[0] ?? 'interrupted' : String(error)
    }
    // The first quarter is warm-up (scrollback filling, caches): the trend is fitted on the rest.
    const steady = samples.filter((s) => s.h >= samples.at(-1)!.h / 4)
    const trend: Record<string, number> = {}
    for (const key of ['total', 'footprint', 'renderer', 'main', 'daemon', 'rendererHeap', 'mainHeap'] as const) {
      trend[key] = Math.round(slope(steady.map((s) => ({ x: s.h, y: s[key] }))) * 10) / 10
    }
    const first = steady[0]!
    const last = samples.at(-1)!
    const result = { minutes: SOAK_MIN, ranHours: Math.round(last.h * 100) / 100, interrupted, sessions: SOAK_SESSIONS, samples: samples.length, mbPerHour: trend, start: first, end: last }
    writeFileSync(join(OUT, `soak-${SOAK_SESSIONS}-summary.json`), JSON.stringify(result, null, 2))
    console.log(`soak ${result.ranHours} h × ${SOAK_SESSIONS} sessions${interrupted ? ` (interrupted: ${interrupted})` : ''}: MB/hour after warm-up ${JSON.stringify(trend)}; start ${JSON.stringify(first)}; end ${JSON.stringify(last)}`)
    expect(interrupted).toBeNull()
  } finally {
    await rig.close()
    // An app that died leaves its sessions in the daemon.
    rig.endDaemon()
  }
})
