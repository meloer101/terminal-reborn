// WebGL glyph-atlas stress (xterm.js #5847 / #5883 / #6042; Superset #3572 #4639 #4601: garbled Chinese with 7–8
// Claude Code tabs). Eight sessions run a fake agent (cjk-agent.mjs) that prints Chinese text with many colors and
// attributes; one of them is shown with the WebGL renderer while all eight print, until its glyph atlas fills up and
// merges pages. After every burst the shown terminal is compared with itself redrawn from the same atlas (every page
// re-uploaded, every cell looked up again); at the end of a round, with the atlas rebuilt from scratch. A pixel that
// changes is a glyph the GPU drew from the wrong place. On addon-webgl 0.19 every merge garbles the screen; the
// atlas guard (src/renderer/terminal/atlas-guard.ts) keeps it from merging. A second test records memory and input
// latency with the eight sessions streaming (ROADMAP D1).
//
// Opt-in, it takes a few minutes:  TR_STRESS=1 npx playwright test e2e/webgl-cjk-stress.spec.ts
// Knobs: TR_STRESS_ROUNDS (default 8, one per session), TR_STRESS_BURSTS (default 6 per round), TR_STRESS_PROFILE
// (`agent`, the default, or `dense`: every glyph on screen distinct, see cjk-agent.mjs).
// Evidence (screenshots of every mismatch, JSON logs) goes to test-results/webgl-cjk-stress/ or $TR_STRESS_OUT.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { outerClaudeEnv } from './fake-claude'
import { launchApp } from './launch'
import { decodePng, encodePng, type Raster } from './png'

const AGENT = resolve('e2e/cjk-agent.mjs')
/** Playwright empties test-results/ on every run; TR_STRESS_OUT keeps the evidence of several runs apart. */
const OUT = process.env.TR_STRESS_OUT ?? join(process.cwd(), 'test-results', 'webgl-cjk-stress')
const FIXTURE_SESSIONS = ['s-cookie', 's-perf', 's-nav', 's-acme-main', 's-sidebar', 's-graph']
const EXTRA_SESSIONS = ['s-stress-7', 's-stress-8']
const SESSIONS = [...FIXTURE_SESSIONS, ...EXTRA_SESSIONS]
const ROUNDS = Number(process.env.TR_STRESS_ROUNDS ?? SESSIONS.length)
const BURSTS = Number(process.env.TR_STRESS_BURSTS ?? 6)
const PROFILE = process.env.TR_STRESS_PROFILE === 'dense' ? 'dense' : 'agent'
/** Lines per second each background session prints while latency and memory are measured. */
const LOAD_LINES_PER_SECOND = 40
const LATENCY_KEYS = 40

interface Info {
  renderer: 'webgl' | 'dom'
  cols: number
  rows: number
  atlasPages: number[] | null
  atlasResets: { recreated: number; overflowed: number }
}
interface Hook {
  readScreen(sessionId: string, scrollbackLines?: number): string
  info(sessionId: string): Info | null
  redraw(sessionId: string, mode: 'rebind' | 'rebuild'): void
}
interface WorkspaceStore {
  getState(): { sessions: { id: string }[]; setActiveSession(id: string): void }
  setState(update: (state: { sessions: object[] }) => { sessions: object[] }): void
}
interface Globals {
  __TR_E2E__: boolean
  __trTerminals: Hook
  __trWorkspace: WorkspaceStore
  tr: { pty: { write(id: string, data: string): void } }
}

let app: ElectronApplication
let page: Page
let userData: string
const bursts = new Map<string, number>()

const screen = (id: string) => page.evaluate((sid) => (globalThis as unknown as Globals).__trTerminals.readScreen(sid, 0), id)
const info = (id: string) => page.evaluate((sid) => (globalThis as unknown as Globals).__trTerminals.info(sid), id)
const write = (id: string, data: string) =>
  page.evaluate(([sid, d]) => (globalThis as unknown as Globals).tr.pty.write(sid as string, d as string), [id, data])
const redraw = (id: string, mode: 'rebind' | 'rebuild') =>
  page.evaluate(([sid, m]) => (globalThis as unknown as Globals).__trTerminals.redraw(sid as string, m as 'rebind' | 'rebuild'), [id, mode])
const frames = (count: number) =>
  page.evaluate(
    (n) =>
      new Promise<void>((done) => {
        let left = n
        const step = (): void => void (--left <= 0 ? done() : requestAnimationFrame(step))
        requestAnimationFrame(step)
      }),
    count
  )
const pane = (id: string) => page.locator(`[data-region="terminal"] [data-session-id="${id}"]`)

async function activate(id: string): Promise<void> {
  await page.evaluate((sid) => (globalThis as unknown as Globals).__trWorkspace.getState().setActiveSession(sid), id)
  await expect(pane(id)).toBeVisible()
  await frames(4)
}

async function shot(id: string): Promise<Raster> {
  const box = await pane(id).locator('.xterm-screen').boundingBox()
  if (!box) throw new Error(`terminal ${id} not laid out`)
  return decodePng(await page.screenshot({ clip: box }))
}

interface Mismatch {
  pixels: number
  cells: number
}

function compare(a: Raster, b: Raster, cols: number, rows: number): Mismatch {
  if (a.width !== b.width || a.height !== b.height) return { pixels: Number.POSITIVE_INFINITY, cells: Number.POSITIVE_INFINITY }
  const cellW = a.width / cols
  const cellH = a.height / rows
  const cells = new Set<number>()
  let pixels = 0
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2]) continue
    pixels++
    const p = i / 4
    cells.add(Math.floor(p / a.width / cellH) * cols + Math.floor((p % a.width) / cellW))
  }
  return { pixels, cells: cells.size }
}

/** Saves both frames and a diff (the first frame dimmed, changed pixels in red) for the report. */
function saveEvidence(name: string, a: Raster, b: Raster): void {
  const png = (r: Raster, pixel?: (i: number) => [number, number, number]) =>
    encodePng(r.width, r.height, (x, y) => {
      const i = (y * r.width + x) * 4
      return pixel ? pixel(i) : [r.data[i]!, r.data[i + 1]!, r.data[i + 2]!]
    })
  writeFileSync(join(OUT, `${name}-shown.png`), png(a))
  writeFileSync(join(OUT, `${name}-expected.png`), png(b))
  writeFileSync(
    join(OUT, `${name}-diff.png`),
    png(a, (i) => {
      const same = a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2]
      return same ? [a.data[i]! >> 2, a.data[i + 1]! >> 2, a.data[i + 2]! >> 2] : [255, 40, 40]
    })
  )
}

/** Every session prints its next burst; resolves when all of them have finished printing it. */
async function burstAll(): Promise<void> {
  for (const id of SESSIONS) {
    bursts.set(id, (bursts.get(id) ?? 0) + 1)
    await write(id, 'g')
  }
  for (const id of SESSIONS) await expect.poll(() => screen(id), { timeout: 20_000 }).toContain(`@@done ${bursts.get(id)}@@`)
}

test.describe.configure({ mode: 'serial' })
test.skip(!process.env.TR_STRESS, 'opt-in stress run: TR_STRESS=1')

test.beforeAll(async () => {
  test.setTimeout(120_000)
  mkdirSync(OUT, { recursive: true })
  userData = mkdtempSync(join(tmpdir(), 'tr-stress-'))
  app = await launchApp(outerClaudeEnv(), { userDataDir: userData })
  page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
  })
  await page.reload()
  await page.waitForFunction(() => Boolean((globalThis as unknown as { __trWorkspace?: unknown }).__trWorkspace))

  // Six fixture sessions plus two plain shells make eight.
  await page.evaluate((ids) => {
    const now = Date.now()
    ;(globalThis as unknown as Globals).__trWorkspace.setState((state) => ({
      sessions: [
        ...state.sessions,
        ...ids.map((id, i) => ({ id, worktreeId: 'w-acme-main', kind: 'shell', title: `压测 ${i + 7}`, status: 'idle', startedAt: now, lastActivityAt: now }))
      ]
    }))
  }, EXTRA_SESSIONS)

  // Terminals spawn on first view: show each once, wait for its shell, then replace the shell with the fake agent.
  for (const [i, id] of SESSIONS.entries()) {
    await activate(id)
    await expect.poll(() => screen(id), { timeout: 20_000 }).not.toBe('')
    await write(id, `clear; exec '${process.execPath}' '${AGENT}' ${i + 1} ${LOAD_LINES_PER_SECOND} ${PROFILE}\r`)
    await expect.poll(() => screen(id), { timeout: 20_000 }).toContain(`@@ready ${i + 1}@@`)
  }
})

test.afterAll(async () => {
  await app?.close()
})

test('the WebGL terminal draws what its buffer holds while eight sessions stream Chinese text', async () => {
  test.setTimeout(15 * 60_000)
  await activate(SESSIONS[0]!)
  const shown = await info(SESSIONS[0]!)
  test.skip(shown?.renderer !== 'webgl', 'needs the WebGL renderer')

  interface Row {
    round: number
    session: string
    burst: number | 'rebuild'
    renderer: string
    atlasPages: number[] | null
    atlasResets: Info['atlasResets'] | null
    mismatch: Mismatch
  }
  const log: Row[] = []
  const record = (row: Row): void => {
    log.push(row)
    const pages = row.atlasPages ? `${row.atlasPages.length} pages [${row.atlasPages.join(',')}]` : 'no atlas'
    const resets = row.atlasResets ? `, guard ${JSON.stringify(row.atlasResets)}` : ''
    console.log(`round ${row.round} ${row.session} burst ${row.burst}: ${row.renderer}, ${pages}${resets}, ${row.mismatch.cells} cells / ${row.mismatch.pixels} px differ`)
  }

  for (let round = 0; round < ROUNDS; round++) {
    const id = SESSIONS[round % SESSIONS.length]!
    await activate(id)
    let expected: Raster | null = null
    let size = { cols: 0, rows: 0 }
    for (let burst = 1; burst <= BURSTS; burst++) {
      await burstAll()
      await frames(3)
      const before = await info(id)
      size = { cols: before?.cols ?? 0, rows: before?.rows ?? 0 }
      const drawn = await shot(id)
      // Same atlas, every page uploaded again and every cell looked up again: what this frame should have shown.
      await redraw(id, 'rebind')
      await frames(3)
      expected = await shot(id)
      const mismatch = compare(drawn, expected, size.cols, size.rows)
      if (mismatch.pixels > 0) saveEvidence(`r${round}-b${burst}-${id}`, drawn, expected)
      record({ round, session: id, burst, renderer: before?.renderer ?? '?', atlasPages: before?.atlasPages ?? null, atlasResets: before?.atlasResets ?? null, mismatch })
    }
    // A fresh atlas: catches an atlas whose own bookkeeping went wrong (a rebind draws that faithfully).
    const last = await info(id)
    await redraw(id, 'rebuild')
    await frames(3)
    const rebuilt = await shot(id)
    const mismatch = expected ? compare(expected, rebuilt, size.cols, size.rows) : { pixels: 0, cells: 0 }
    if (expected && mismatch.pixels > 0) saveEvidence(`r${round}-rebuild-${id}`, expected, rebuilt)
    record({ round, session: id, burst: 'rebuild', renderer: last?.renderer ?? '?', atlasPages: last?.atlasPages ?? null, atlasResets: last?.atlasResets ?? null, mismatch })
  }

  writeFileSync(join(OUT, 'atlas-log.json'), JSON.stringify(log, null, 2))
  const merged = log.some((row) => row.atlasPages?.some((width) => width > 512))
  console.log(`atlas merged pages during the run: ${merged}`)
  // The DOM renderer has no atlas (and its scrollbar fades between two shots): only WebGL frames count.
  const bad = log.filter((row) => row.renderer === 'webgl' && row.mismatch.pixels > 0)
  expect(bad, `frames that differ from a redraw of the same buffer (see ${OUT})`).toEqual([])
  // Agent-like output must fit the atlas; `dense` screens may not, and then fall back to DOM on purpose.
  if (PROFILE === 'agent') expect(log.filter((row) => row.renderer !== 'webgl')).toEqual([])
})

/** Resident memory of the app's processes and the pty daemon, in MB (agents and their shells are not counted). */
async function memory(): Promise<{ byType: Record<string, number>; daemon: number; total: number; rendererHeap: number }> {
  const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics())
  const byType: Record<string, number> = {}
  for (const m of metrics) byType[m.type] = (byType[m.type] ?? 0) + m.memory.workingSetSize / 1024
  const ps = execFileSync('ps', ['-axo', 'pid=,rss=,command='], { encoding: 'utf8' })
  const daemonLine = ps.split('\n').find((l) => l.includes(join(userData, 'daemon')) && l.includes('--socket'))
  const daemon = daemonLine ? Number(daemonLine.trim().split(/\s+/)[1]) / 1024 : 0
  // performance.memory is bucketed without --enable-precise-memory-info; the inspector protocol is exact.
  const cdp = await page.context().newCDPSession(page)
  const rendererHeap = ((await cdp.send('Runtime.getHeapUsage')) as { usedSize: number }).usedSize / 1048576
  await cdp.detach()
  const total = Object.values(byType).reduce((a, b) => a + b, 0) + daemon
  return { byType, daemon, total, rendererHeap }
}

async function cpu(): Promise<Record<string, number>> {
  const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics())
  const byType: Record<string, number> = {}
  for (const m of metrics) byType[m.type] = (byType[m.type] ?? 0) + m.cpu.percentCPUUsage
  return byType
}

/** Keys typed into each session so far: the fake agent numbers its answers from 1. */
const keysTyped = new Map<string, number>()

/** Types `k` into the shown session LATENCY_KEYS times; each comes back as `@@key n@@`. Key-down → first frame showing it, in ms. */
async function latency(id: string): Promise<{ p50: number; p95: number; max: number; samples: number[] }> {
  await pane(id).click()
  const base = keysTyped.get(id) ?? 0
  keysTyped.set(id, base + LATENCY_KEYS)
  await page.evaluate(([sid, from]) => {
    const w = globalThis as unknown as { __lat?: { down: number[]; seen: Map<number, number>; stop: boolean; base: number } } & Globals
    const lat = { down: [] as number[], seen: new Map<number, number>(), stop: false, base: 0 }
    const keys = (): number[] => [...w.__trTerminals.readScreen(sid as string, 0).matchAll(/@@key (\d+)@@/g)].map((m) => Number(m[1]))
    lat.base = from as number
    w.__lat = lat
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'k') lat.down.push(performance.now())
    }
    document.addEventListener('keydown', onKey, true)
    let last = lat.base
    const poll = (t: number): void => {
      // Only answers to this run's keys; an answer that scrolled past between two frames still counts at the next.
      const max = Math.max(0, ...keys().filter((n) => n > lat.base))
      while (last < max) lat.seen.set(++last, t)
      if (!lat.stop) requestAnimationFrame(poll)
      else document.removeEventListener('keydown', onKey, true)
    }
    requestAnimationFrame(poll)
  }, [id, base])
  for (let i = 0; i < LATENCY_KEYS; i++) {
    await page.keyboard.press('k')
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(500)
  const samples = await page.evaluate(() => {
    const lat = (globalThis as unknown as { __lat: { down: number[]; seen: Map<number, number>; stop: boolean; base: number } }).__lat
    lat.stop = true
    return lat.down.map((t, i) => (lat.seen.get(lat.base + i + 1) ?? Number.NaN) - t)
  })
  const sorted = samples.filter((s) => Number.isFinite(s)).sort((a, b) => a - b)
  const at = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN)
  return { p50: at(0.5), p95: at(0.95), max: Math.round(sorted.at(-1) ?? Number.NaN), samples: samples.map(Math.round) }
}

test('memory and input latency with eight sessions (ROADMAP D1 data point)', async () => {
  test.setTimeout(5 * 60_000)
  const focused = SESSIONS[0]!
  const background = SESSIONS.slice(1)
  await activate(focused)
  await redraw(focused, 'rebuild')
  await page.waitForTimeout(2000)

  const idleMemory = await memory()
  const idleLatency = await latency(focused)

  for (const id of background) await write(id, 'r')
  await page.waitForTimeout(10_000)
  const loadMemory: Awaited<ReturnType<typeof memory>>[] = []
  const loadCpu: Record<string, number>[] = []
  for (let i = 0; i < 5; i++) {
    loadMemory.push(await memory())
    loadCpu.push(await cpu())
    await page.waitForTimeout(2000)
  }
  const loadLatency = await latency(focused)

  // The shown session streams too: typing into a session that is printing.
  await write(focused, 'r')
  await page.waitForTimeout(3000)
  const busyLatency = await latency(focused)
  const busyMemory = await memory()
  for (const id of SESSIONS) await write(id, 's')

  const scrollback = await page.evaluate(
    (ids) => ids.map((id) => (globalThis as unknown as Globals).__trTerminals.readScreen(id, 10_000).split('\n').length),
    SESSIONS
  )
  const result = {
    sessions: SESSIONS.length,
    linesPerSecondPerBackgroundSession: LOAD_LINES_PER_SECOND,
    renderer: (await info(focused))?.renderer,
    idle: { memory: idleMemory, latency: idleLatency },
    load: { memory: loadMemory, cpu: loadCpu, latency: loadLatency },
    busy: { memory: busyMemory, latency: busyLatency },
    scrollbackLines: scrollback
  }
  writeFileSync(join(OUT, 'd1-metrics.json'), JSON.stringify(result, null, 2))
  const mb = (n: number) => `${Math.round(n)} MB`
  console.log(`idle: total ${mb(idleMemory.total)} (${Object.entries(idleMemory.byType).map(([k, v]) => `${k} ${mb(v)}`).join(', ')}, daemon ${mb(idleMemory.daemon)}), heap ${mb(idleMemory.rendererHeap)}`)
  console.log(`idle latency p50 ${idleLatency.p50} ms, p95 ${idleLatency.p95} ms, max ${idleLatency.max} ms`)
  const peak = loadMemory.reduce((a, b) => (b.total > a.total ? b : a))
  console.log(`load: peak total ${mb(peak.total)} (${Object.entries(peak.byType).map(([k, v]) => `${k} ${mb(v)}`).join(', ')}, daemon ${mb(peak.daemon)}), heap ${mb(peak.rendererHeap)}`)
  console.log(`load cpu: ${JSON.stringify(loadCpu.at(-1))}`)
  console.log(`load latency p50 ${loadLatency.p50} ms, p95 ${loadLatency.p95} ms, max ${loadLatency.max} ms`)
  console.log(`busy latency p50 ${busyLatency.p50} ms, p95 ${busyLatency.p95} ms, max ${busyLatency.max} ms; total ${mb(busyMemory.total)}`)
  expect(loadLatency.samples.filter((s) => Number.isNaN(s))).toEqual([])
})
