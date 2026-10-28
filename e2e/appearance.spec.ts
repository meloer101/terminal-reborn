import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import type { SettingsPatch } from '../src/shared/settings'
import { launchApp } from './launch'
import { decodePng, type Raster } from './png'

interface SurfaceInfo {
  fontFamily: string
  fontSize: number
  lineHeight: number
  allowTransparency: boolean
  background: string
  renderer: 'webgl' | 'dom'
  ligatures: boolean
  cols: number
  rows: number
}
interface Hook {
  readScreen(sessionId: string, scrollbackLines?: number): string
  info(sessionId: string): SurfaceInfo | null
}
const FIRST = 's-cookie'
const SECOND = 's-perf'
const SHOTS = 'test-results'

let app: ElectronApplication
let page: Page

const pane = (sessionId: string) => page.locator(`[data-region="terminal"] [data-session-id="${sessionId}"]`)
const terminalRegion = () => page.locator('[data-region="terminal"]')
const terminalCard = () => terminalRegion().locator('[data-session-id][data-shown="true"]').first()

const hook = <T>(fn: (h: Hook, arg: string) => T, arg = '') =>
  page.evaluate(([source, a]) => (new Function('h', 'a', `return (${source})(h, a)`)(
    (globalThis as unknown as { __trTerminals: Hook }).__trTerminals, a
  ) as T), [fn.toString(), arg] as const)

const info = (sessionId: string) => hook((h, id) => h.info(id), sessionId)
const screen = (sessionId: string) => hook((h, id) => h.readScreen(id, 0), sessionId)

const update = (patch: SettingsPatch) =>
  page.evaluate(
    (p) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update(p),
    patch
  )

interface Dom {
  document: { documentElement: { dataset: Record<string, string | undefined> } }
  getComputedStyle(el: unknown): Record<string, string>
}
const theme = () => page.evaluate(() => (globalThis as unknown as Dom).document.documentElement.dataset.theme)

async function run(sessionId: string, command: string): Promise<void> {
  await pane(sessionId).click()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

/** Text with italic, dim, underline, bold and colored backgrounds: the cells that glitch on transparent canvases. */
const SAMPLE =
  "clear; printf '\\033[3mitalic\\033[0m \\033[2mdim text\\033[0m \\033[1;4mbold-ul\\033[0m \\033[1mbold\\033[0m \\033[41m red bg \\033[0m \\033[42m green bg \\033[0m\\n你好世界 0123456789 => != ===\\n\\033[3;2mitalic dim\\033[0m \\033[4munderline\\033[0m \\033[9mstrike\\033[0m\\n'; echo ready-$((40+2))"

/** Screenshot of the terminal region as pixels (and saved under test-results for review). */
async function shoot(name: string): Promise<Raster> {
  await page.waitForTimeout(400)
  const box = await terminalRegion().boundingBox()
  if (!box) throw new Error('terminal region not visible')
  await page.screenshot({ path: `${SHOTS}/${name}-window.png` })
  const png = await page.screenshot({ path: `${SHOTS}/${name}.png`, clip: box })
  return decodePng(png)
}

const TERM_BG = { dark: [10, 10, 10], light: [255, 255, 255] } as const

function pixel(raster: Raster, fx: number, fy: number): [number, number, number] {
  const x = Math.floor(raster.width * fx)
  const y = Math.floor(raster.height * fy)
  const o = (y * raster.width + x) * 4
  return [raster.data[o]!, raster.data[o + 1]!, raster.data[o + 2]!]
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true })
  app = await launchApp()
  page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
  })
  await page.reload()
  await expect(pane(FIRST)).toBeVisible()
  await expect.poll(() => screen(FIRST), { timeout: 20_000 }).not.toBe('')
})

test.afterAll(async () => {
  await app.close()
})

test('font settings reach a live terminal and refit it', async () => {
  const before = await info(FIRST)
  expect(before?.fontSize).toBe(13)

  const started = Date.now()
  await update({ appearance: { fontSize: 16, cjkFont: 'Hiragino Sans GB' } })
  await expect.poll(async () => (await info(FIRST))?.fontSize).toBe(16)
  const elapsed = Date.now() - started
  console.log(`font change applied in ${elapsed} ms`)
  expect(elapsed).toBeLessThan(1000)

  const after = await info(FIRST)
  expect(after?.fontFamily).toContain('Hiragino Sans GB')
  expect(after?.cols).toBeLessThan(before?.cols ?? 0)

  // The shell was told about the new size, without being restarted.
  await run(FIRST, 'clear; echo cols-$(tput cols)')
  await expect.poll(() => screen(FIRST), { timeout: 10_000 }).toMatch(new RegExp(`^cols-${after?.cols}$`, 'm'))
})

test('ligatures toggle registers a joiner; line height applies', async () => {
  expect((await info(FIRST))?.ligatures).toBe(false)
  await update({ appearance: { ligatures: true, lineHeight: 1.5 } })
  await expect.poll(async () => (await info(FIRST))?.ligatures).toBe(true)
  expect((await info(FIRST))?.lineHeight).toBe(1.5)
  await run(FIRST, SAMPLE)
  await expect.poll(() => screen(FIRST), { timeout: 10_000 }).toMatch(/^ready-42$/m)
  await shoot('appearance-ligatures-on')
  await update({ appearance: { ligatures: false, lineHeight: 1.54, fontSize: 13, cjkFont: 'PingFang SC' } })
  await expect.poll(async () => (await info(FIRST))?.ligatures).toBe(false)
})

test('terminal opacity makes the surface transparent only when below 1', async () => {
  expect((await info(FIRST))?.allowTransparency).toBe(false)
  await update({ appearance: { theme: 'dark', terminalOpacity: 0.8 } })
  await expect.poll(async () => (await info(FIRST))?.allowTransparency).toBe(true)
  expect((await info(FIRST))?.background.toLowerCase()).toBe('#0a0a0acc')
  expect((await info(FIRST))?.renderer).toBe('webgl')
  await shoot('appearance-opacity-dark')
  await update({ appearance: { terminalOpacity: 1 } })
  await expect.poll(async () => (await info(FIRST))?.allowTransparency).toBe(false)
})

for (const mode of ['dark', 'light'] as const) {
  test(`the terminal takes the theme's color: ${mode === 'light' ? 'white' : 'near-black'} in ${mode} mode`, async () => {
    // A gradient saved by an older version is ignored: the terminal follows the theme (PRD v1.2).
    await update({ appearance: { theme: mode, background: { kind: 'gradient', from: '#1f1f1f', to: '#050505', angle: 160 } } } as unknown as SettingsPatch)
    await expect.poll(theme).toBe(mode)
    await expect.poll(async () => (await info(FIRST))?.background.toLowerCase()).toBe(mode === 'dark' ? '#0a0a0a' : '#ffffff')
    expect((await info(FIRST))?.allowTransparency).toBe(false)
    await expect.poll(async () => (await info(FIRST))?.renderer).toBe('webgl')
    await run(FIRST, SAMPLE)
    await expect.poll(() => screen(FIRST), { timeout: 10_000 }).toMatch(/^ready-42$/m)
    const raster = await shoot(`appearance-theme-${mode}`)
    expect(pixel(raster, 0.97, 0.9)).toEqual([...TERM_BG[mode]])
  })
}

test('theme setting flips data-theme, including the system preference', async () => {
  await update({ appearance: { theme: 'light' } })
  await expect.poll(theme).toBe('light')
  await update({ appearance: { theme: 'dark' } })
  await expect.poll(theme).toBe('dark')
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'light'
  })
  await update({ appearance: { theme: 'system' } })
  // main sets themeSource = system, which follows the OS; either way the attribute is a valid theme.
  await expect.poll(theme).toMatch(/^(dark|light)$/)
})

test('a terminal created after the change starts with the current appearance', async () => {
  await update({ appearance: { theme: 'dark', fontSize: 15 } })
  await expect.poll(async () => (await info(FIRST))?.fontSize).toBe(15)
  expect(await info(SECOND)).toBeNull()
  await page.getByText('结算页性能优化').click()
  await expect.poll(async () => (await info(SECOND))?.fontSize, { timeout: 20_000 }).toBe(15)
  await update({ appearance: { fontSize: 13 } })
  await expect.poll(async () => (await info(SECOND))?.fontSize).toBe(13)
})

test('a custom terminal background and imported colors reach a live terminal, and clearing them restores the theme (F7 v1.71)', async () => {
  const ansi = Array.from({ length: 16 }, (_, i) => `#${(i * 16 + 15).toString(16).padStart(2, '0').repeat(3)}`)
  await update({ appearance: { theme: 'dark', terminalBackground: { mode: 'custom', color: '#fdf6e3' } } })
  await expect.poll(async () => (await info(FIRST))?.background).toBe('#fdf6e3')
  // The terminal's card uses the same color: what the terminal shows is the color that was set.
  await expect
    .poll(() => terminalCard().evaluate((el) => (globalThis as unknown as Dom).getComputedStyle(el).backgroundColor))
    .toBe('rgb(253, 246, 227)')
  await update({ appearance: { terminalBackground: { mode: 'custom', color: '#262427' }, terminalColors: { foreground: '#fcfcfa', cursor: '#fcfcfa', selection: '#5ea1ff47', ansi } } })
  await expect.poll(async () => (await info(FIRST))?.background).toBe('#262427')
  await update({ appearance: { terminalBackground: { mode: 'theme', color: '#262427' }, terminalColors: null } })
  await expect.poll(async () => (await info(FIRST))?.background).toBe('#0a0a0a')
})

test('the window shell is fixed glass: the sidebar and the header row are see-through, the terminal card is not', async () => {
  const background = (selector: string) => page.locator(selector).first().evaluate((el) => (globalThis as unknown as Dom).getComputedStyle(el).backgroundColor)
  expect(await background('[data-region="sidebar"]')).toBe('rgba(0, 0, 0, 0)')
  expect(await background('[data-region="main"]')).toBe('rgba(0, 0, 0, 0)')
  expect(await background('[data-region="terminal"] [data-session-id][data-shown="true"]')).not.toBe('rgba(0, 0, 0, 0)')
  await page.screenshot({ path: `${SHOTS}/appearance-glass-window.png` })
})
