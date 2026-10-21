// Input latency with the main area split four ways (PRD F20 acceptance, ROADMAP D1): four sessions on screen at once,
// each running the fake agent of webgl-cjk-stress.spec.ts. Measured as in that spec — key-down to the first frame
// showing the agent's answer, so it includes the PTY round trip — while the focused pane is quiet and the other
// three stream Chinese text at 40 lines/s, then with all four streaming. Numbers go to test-results/split/latency.json.
//
// Opt-in, it takes about a minute:  TR_STRESS=1 npx playwright test e2e/split-latency.spec.ts
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { outerClaudeEnv } from './fake-claude'
import { launchApp, setWindowSize } from './launch'

const AGENT = resolve('e2e/cjk-agent.mjs')
const OUT = join(process.cwd(), 'test-results', 'split')
const PANES = ['s-cookie', 's-perf', 's-sidebar', 's-graph'] as const
const LINES_PER_SECOND = 40
const KEYS = 40

interface Globals {
  __TR_E2E__: boolean
  __trTerminals: { readScreen(sessionId: string, scrollbackLines?: number): string; info(sessionId: string): { renderer: string } | null }
  __trWorkspace: { getState(): { setSplit(split: unknown): void; setActiveSession(id: string): void } }
  tr: { pty: { write(id: string, data: string): void } }
}

let app: ElectronApplication
let page: Page
const typed = new Map<string, number>()

const screen = (id: string) => page.evaluate((sid) => (globalThis as unknown as Globals).__trTerminals.readScreen(sid, 0), id)
const write = (id: string, data: string) =>
  page.evaluate(([sid, d]) => (globalThis as unknown as Globals).tr.pty.write(sid as string, d as string), [id, data])
const pane = (id: string) => page.locator(`[data-region="terminal"] [data-session-id="${id}"]`)

/** Types `k` KEYS times into a pane; the agent answers each with `@@key n@@`. Key-down → first frame showing it, in ms. */
async function latency(id: string): Promise<{ p50: number; p95: number; max: number }> {
  await pane(id).click()
  const base = typed.get(id) ?? 0
  typed.set(id, base + KEYS)
  await page.evaluate(([sid, from]) => {
    const w = globalThis as unknown as { __lat?: { down: number[]; seen: Map<number, number>; stop: boolean; base: number } } & Globals
    const lat = { down: [] as number[], seen: new Map<number, number>(), stop: false, base: from as number }
    w.__lat = lat
    const keys = (): number[] => [...w.__trTerminals.readScreen(sid as string, 0).matchAll(/@@key (\d+)@@/g)].map((m) => Number(m[1]))
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
  }, [id, base])
  for (let i = 0; i < KEYS; i++) {
    await page.keyboard.press('k')
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(500)
  const samples = await page.evaluate(() => {
    const lat = (globalThis as unknown as { __lat: { down: number[]; seen: Map<number, number>; stop: boolean; base: number } }).__lat
    lat.stop = true
    return lat.down.map((t, i) => (lat.seen.get(lat.base + i + 1) ?? Number.NaN) - t)
  })
  expect(samples.filter((s) => Number.isNaN(s))).toEqual([])
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN)
  return { p50: at(0.5), p95: at(0.95), max: Math.round(sorted.at(-1) ?? Number.NaN) }
}

test.describe.configure({ mode: 'serial' })
test.skip(!process.env.TR_STRESS, 'opt-in measurement: TR_STRESS=1')

test.beforeAll(async () => {
  test.setTimeout(120_000)
  mkdirSync(OUT, { recursive: true })
  app = await launchApp(outerClaudeEnv(), { userDataDir: mkdtempSync(join(tmpdir(), 'tr-split-latency-')) })
  page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
  })
  await page.reload()
  await setWindowSize(app, page, 1440, 900)
  await page.waitForFunction(() => Boolean((globalThis as unknown as { __trWorkspace?: unknown }).__trWorkspace))
  // A 2×2 split of four fixture sessions.
  await page.evaluate((ids) => {
    const [a, b, c, d] = ids
    const col = (top: string, bottom: string) => ({ type: 'split', dir: 'column', sizes: [0.5, 0.5], children: [{ type: 'pane', id: top }, { type: 'pane', id: bottom }] })
    const store = (globalThis as unknown as Globals).__trWorkspace.getState()
    store.setActiveSession(a!)
    ;(globalThis as unknown as Globals).__trWorkspace.getState().setSplit({ type: 'split', dir: 'row', sizes: [0.5, 0.5], children: [col(a!, c!), col(b!, d!)] })
  }, [...PANES])
  for (const [i, id] of PANES.entries()) {
    await expect(pane(id)).toBeVisible()
    await expect.poll(() => screen(id), { timeout: 20_000 }).not.toBe('')
    await write(id, `clear; exec '${process.execPath}' '${AGENT}' ${i + 1} ${LINES_PER_SECOND} agent\r`)
    await expect.poll(() => screen(id), { timeout: 20_000 }).toContain(`@@ready ${i + 1}@@`)
  }
})

test.afterAll(async () => {
  await app?.close()
})

test('typing into one of four panes stays quick while the others stream', async () => {
  test.setTimeout(3 * 60_000)
  const [focused, ...others] = PANES
  const idle = await latency(focused)
  for (const id of others) await write(id, 'r')
  await page.waitForTimeout(5000)
  const load = await latency(focused)
  await write(focused, 'r')
  await page.waitForTimeout(3000)
  const busy = await latency(focused)
  for (const id of PANES) await write(id, 's')
  const renderer = await page.evaluate((id) => (globalThis as unknown as Globals).__trTerminals.info(id)?.renderer, focused)
  const result = { panes: PANES.length, linesPerSecondPerStreamingPane: LINES_PER_SECOND, renderer, idle, load, busy }
  writeFileSync(join(OUT, 'latency.json'), JSON.stringify(result, null, 2))
  console.log(`4 panes, ${renderer}: idle p50 ${idle.p50} / p95 ${idle.p95} ms; three streaming p50 ${load.p50} / p95 ${load.p95} ms; all four streaming p50 ${busy.p50} / p95 ${busy.p95} ms`)
})
