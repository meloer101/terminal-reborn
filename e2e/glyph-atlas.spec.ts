// Regression: opening Settings must not corrupt the glyphs a session terminal already shows.
// The WebGL addon shares one glyph atlas between terminals with the same font and colors; when the
// settings preview cleared it, the session terminal kept texture coordinates into the wiped atlas
// and its next frame drew garbage (black blocks, wrong characters) over every unchanged row.
import { expect, test, type Page } from '@playwright/test'
import { launchApp } from './launch'
import { decodePng } from './png'

const SESSION = 's-cookie'
/**
 * Rows at the top of the screen that hold the printed sample and must not change. The shell prompt follows on
 * the next row with a one-line prompt (zsh's default, as on CI), and `echo after-settings` is typed there.
 */
const SAMPLE_ROWS = 4

interface Hook {
  readScreen(sessionId: string, scrollbackLines?: number): string
  info(sessionId: string): { renderer: 'webgl' | 'dom'; rows: number } | null
}
interface Globals {
  __TR_E2E__: boolean
  __trTerminals: Hook
  tr: { pty: { write(id: string, data: string): void } }
}

function outerClaudeEnv(): Record<string, undefined> {
  const strip: Record<string, undefined> = {}
  for (const key of Object.keys(process.env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_') || key.startsWith('CLAUDE_AGENT_')) strip[key] = undefined
  }
  return strip
}

const screen = (page: Page) => page.evaluate((id) => (globalThis as unknown as Globals).__trTerminals.readScreen(id, 0), SESSION)
const info = (page: Page) => page.evaluate((id) => (globalThis as unknown as Globals).__trTerminals.info(id), SESSION)
const write = (page: Page, data: string) =>
  page.evaluate(([id, d]) => (globalThis as unknown as Globals).tr.pty.write(id as string, d as string), [SESSION, data])

/** Pixels of the top SAMPLE_ROWS rows of the session's terminal. */
async function sampleShot(page: Page, rows: number): Promise<Buffer> {
  const box = await page.locator(`[data-region="terminal"] [data-session-id="${SESSION}"] .xterm-screen`).boundingBox()
  if (!box) throw new Error('terminal screen not laid out')
  return page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: (box.height / rows) * SAMPLE_ROWS } })
}

function differingPixels(a: Buffer, b: Buffer): number {
  const x = decodePng(a)
  const y = decodePng(b)
  if (x.width !== y.width || x.height !== y.height) return Number.POSITIVE_INFINITY
  let diff = 0
  for (let i = 0; i < x.data.length; i += 4) {
    if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2]) diff++
  }
  return diff
}

test('opening Settings leaves the session terminal glyphs intact', async () => {
  test.setTimeout(60_000)
  const app = await launchApp(outerClaudeEnv())
  const page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as Globals).__TR_E2E__ = true
  })
  await page.reload()
  await expect.poll(() => screen(page), { timeout: 20_000 }).not.toBe('')
  const surface = await info(page)
  test.skip(surface?.renderer !== 'webgl', 'needs the WebGL renderer (the atlas is WebGL-only)')
  const rows = surface?.rows ?? 0

  // Claude Code's logo (block elements), Latin and CJK: a spread of glyphs across the atlas.
  await write(page, "clear; printf ' ▐▛███▜▌   Claude Code\\n▝▜█████▛▘  ~/project\\n  ▘▘ ▝▝\\nHello WORLD 0123456789 中文宽度测试\\n'\r")
  await expect.poll(() => screen(page), { timeout: 10_000 }).toContain('中文宽度测试')
  await page.waitForTimeout(300)
  const before = await sampleShot(page, rows)

  const sidebar = page.locator('[data-region="sidebar"]')
  await sidebar.getByRole('button', { name: /设置/ }).click()
  await expect(page.getByRole('img', { name: '终端预览' })).toBeVisible()
  await page.waitForTimeout(500) // the preview loads fonts and draws its sample
  await page.keyboard.press('Escape')
  await expect(page.getByRole('img', { name: '终端预览' })).toBeHidden()

  // New output makes the session terminal render a frame, which is when stale glyphs showed up.
  await write(page, 'echo after-settings\r')
  await expect.poll(() => screen(page), { timeout: 10_000 }).toContain('after-settings')
  await page.waitForTimeout(300)
  const after = await sampleShot(page, rows)

  expect(differingPixels(before, after)).toBe(0)
  await app.close()
})
