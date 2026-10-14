import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SettingsPatch } from '../src/shared/settings'
import { launchApp } from './launch'
import { decodePng, encodePng, type Raster } from './png'

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
let wallpaper: string

const pane = (sessionId: string) => page.locator(`[data-region="terminal"] [data-session-id="${sessionId}"]`)
const terminalRegion = () => page.locator('[data-region="terminal"]')

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

/**
 * Pixels equal to the opaque terminal color (or pure black): what a transparent WebGL canvas leaves
 * behind italic/dim/underlined cells. Over a gradient or image none should remain.
 */
function opaqueCellPixels(raster: Raster, termBg: [number, number, number]): number {
  let count = 0
  const near = (a: number, b: number) => Math.abs(a - b) <= 3
  for (let i = 0; i < raster.data.length; i += 4) {
    const r = raster.data[i] ?? 0
    const g = raster.data[i + 1] ?? 0
    const b = raster.data[i + 2] ?? 0
    if ((near(r, termBg[0]) && near(g, termBg[1]) && near(b, termBg[2])) || (r < 4 && g < 4 && b < 4)) count++
  }
  return count
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
  wallpaper = join(mkdtempSync(join(tmpdir(), 'tr-wall-')), '壁纸 (test).png')
  // Diagonal blue→orange wallpaper with brighter stripes, so any black cell stands out.
  writeFileSync(
    wallpaper,
    encodePng(640, 400, (x, y) => {
      const t = (x / 640 + y / 400) / 2
      const stripe = Math.floor((x + y) / 40) % 2 === 0 ? 24 : 0
      return [Math.min(255, 40 + 190 * t + stripe), Math.min(255, 90 + 60 * (1 - t) + stripe), Math.min(255, 200 - 120 * t + stripe)]
    })
  )
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
  expect((await info(FIRST))?.renderer).toBe('dom')
  await shoot('appearance-opacity-dark')
  await update({ appearance: { terminalOpacity: 1 } })
  await expect.poll(async () => (await info(FIRST))?.allowTransparency).toBe(false)
})

for (const mode of ['dark', 'light'] as const) {
  test(`gradient background renders behind the terminal (${mode})`, async () => {
    await update({ appearance: { theme: mode, background: { kind: 'gradient', from: '#1d4f91', to: '#c2410c', angle: 135 } } })
    await expect.poll(theme).toBe(mode)
    await expect
      .poll(() => terminalRegion().evaluate((el) => (globalThis as unknown as Dom).getComputedStyle(el).backgroundImage))
      .toContain('linear-gradient(135deg')
    await expect.poll(async () => (await info(FIRST))?.allowTransparency).toBe(true)
    expect((await info(FIRST))?.background).toBe('#' + (mode === 'dark' ? '0a0a0a' : 'ffffff') + '00')

    await run(FIRST, SAMPLE)
    await expect.poll(() => screen(FIRST), { timeout: 10_000 }).toMatch(/^ready-42$/m)
    const raster = await shoot(`appearance-gradient-${mode}`)
    expect((await info(FIRST))?.renderer).toBe('dom')
    expect(opaqueCellPixels(raster, [...TERM_BG[mode]])).toBe(0)
    // Far from any text the gradient shows through the (transparent) cells: it is not the flat terminal color.
    const [r, , b] = pixel(raster, 0.97, 0.9)
    expect(Math.abs(r - b)).toBeGreaterThan(30)
  })

  test(`image background with dim renders behind the terminal (${mode})`, async () => {
    await update({ appearance: { theme: mode, background: { kind: 'image', path: wallpaper, dim: 0.35 } } })
    await expect.poll(theme).toBe(mode)
    await expect
      .poll(() => terminalRegion().evaluate((el) => (globalThis as unknown as Dom).getComputedStyle(el).backgroundImage))
      .toContain('url("file:///')
    await run(FIRST, SAMPLE)
    await expect.poll(() => screen(FIRST), { timeout: 10_000 }).toMatch(/^ready-42$/m)
    const raster = await shoot(`appearance-image-${mode}`)
    expect(opaqueCellPixels(raster, [...TERM_BG[mode]])).toBe(0)
    const [r, , b] = pixel(raster, 0.97, 0.9)
    expect(Math.abs(r - b)).toBeGreaterThan(20)
  })
}

test('back to solid restores an opaque surface', async () => {
  await update({ appearance: { theme: 'dark', background: { kind: 'solid' } } })
  await expect.poll(async () => (await info(FIRST))?.allowTransparency).toBe(false)
  expect((await info(FIRST))?.background.toLowerCase()).toBe('#0a0a0a')
  await expect.poll(async () => (await info(FIRST))?.renderer).toBe('webgl')
  await expect.poll(() => terminalRegion().evaluate((el) => (globalThis as unknown as Dom).getComputedStyle(el).backgroundImage)).toBe('none')
})

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

test('sidebar vibrancy flips the sidebar to see-through and back', async () => {
  const sidebarBackground = () => page.locator('[data-region="sidebar"]').evaluate((el) => (globalThis as unknown as Dom).getComputedStyle(el).backgroundColor)
  expect(await sidebarBackground()).not.toBe('rgba(0, 0, 0, 0)')
  await update({ appearance: { sidebarVibrancy: true } })
  await expect.poll(sidebarBackground).toBe('rgba(0, 0, 0, 0)')
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SHOTS}/appearance-vibrancy-on-window.png` })
  await update({ appearance: { sidebarVibrancy: false } })
  await expect.poll(sidebarBackground).not.toBe('rgba(0, 0, 0, 0)')
})
