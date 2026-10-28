// Translucent terminals run on the WebGL renderer (PRD §6.3). Stock addon-webgl paints an opaque rectangle behind
// italic / dim cells when the theme background has an alpha (xterm.js #6116), and paints the default background a
// second time over the one xterm already gives the viewport element; patches/@xterm+addon-webgl+*.patch fixes both.
// With the patch the translucent surface must look like the DOM renderer's: the same color behind plain, dim and
// italic cells, explicit backgrounds still opaque, and wrapped CJK rows still end on the cell grid.
// TR_SHOTS_DIR keeps the screenshots (default: test-results/).
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from './launch'
import { decodePng, type Raster } from './png'

const SESSION = 's-cookie'
const SHOTS = process.env.TR_SHOTS_DIR ?? join(process.cwd(), 'test-results')
/** Half transparent over a solid blue backdrop: opaque cells and double-painted backgrounds are easy to tell apart. */
const OPACITY = 0.5
const BACKDROP = 'rgb(0, 0, 255)'
const TEXT =
  '现在在worktree这里，点击打开一个worktree的详情之后就没办法收起，只能点击另一个才行但是另一个又打开并且不能收起来了；所以我希望新增一个可以单击之后收起的小feature'

interface Globals {
  __TR_E2E__: boolean
  __trTerminals: {
    readScreen(id: string, scrollbackLines?: number): string
    info(id: string): { renderer: 'webgl' | 'dom'; cols: number; rows: number; allowTransparency: boolean } | null
    renderer(id: string, mode: 'auto' | 'dom'): void
  }
  tr: { pty: { write(id: string, data: string): void }; settings: { update(patch: unknown): Promise<unknown> } }
}
type Rgb = [number, number, number]
interface Grid {
  clip: { x: number; y: number; width: number; height: number }
  cols: number
  rows: number
}

async function geometry(page: Page): Promise<Grid> {
  return page.evaluate((id) => {
    const doc = (globalThis as unknown as { document: Document }).document
    const screen = doc.querySelector(`[data-region="terminal"] [data-session-id="${id}"] .xterm-screen`)!.getBoundingClientRect()
    const info = (globalThis as unknown as Globals).__trTerminals.info(id)!
    return { clip: { x: screen.x, y: screen.y, width: screen.width, height: screen.height }, cols: info.cols, rows: info.rows }
  }, SESSION)
}

/** The most common color in a block of cells: the background, whatever glyphs are drawn on it. */
function modalColor(raster: Raster, grid: Grid, row: number, col0: number, col1: number, rows = 1): Rgb {
  const scale = raster.width / grid.clip.width
  const cw = (grid.clip.width / grid.cols) * scale
  const ch = (grid.clip.height / grid.rows) * scale
  const counts = new Map<number, number>()
  for (let y = Math.floor(row * ch) + 1; y < Math.floor((row + rows) * ch) - 1; y++) {
    for (let x = Math.floor(col0 * cw) + 1; x < Math.floor(col1 * cw) - 1; x++) {
      const o = (y * raster.width + x) * 4
      const key = (raster.data[o]! << 16) | (raster.data[o + 1]! << 8) | raster.data[o + 2]!
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const [key] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!
  return [key >> 16, (key >> 8) & 255, key & 255]
}

function pixel(raster: Raster, grid: Grid, cssX: number, cssY: number): Rgb {
  const scale = raster.width / grid.clip.width
  const o = (Math.floor(cssY * scale) * raster.width + Math.floor(cssX * scale)) * 4
  return [raster.data[o]!, raster.data[o + 1]!, raster.data[o + 2]!]
}

const near = (a: Rgb, b: Rgb, tolerance: number) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance)

test('a translucent terminal draws on WebGL with the DOM renderer’s look, and CJK rows end on the grid', async () => {
  test.setTimeout(90_000)
  mkdirSync(SHOTS, { recursive: true })
  const app = await launchApp()
  const page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as Globals).__TR_E2E__ = true
  })
  await page.reload()
  const screen = () => page.evaluate((id) => (globalThis as unknown as Globals).__trTerminals.readScreen(id, 0), SESSION)
  const renderer = () => page.evaluate((id) => (globalThis as unknown as Globals).__trTerminals.info(id)?.renderer, SESSION)
  const write = (data: string) => page.evaluate(([id, d]) => (globalThis as unknown as Globals).tr.pty.write(id!, d!), [SESSION, data])
  await expect.poll(screen, { timeout: 20_000 }).not.toBe('')

  await page.evaluate((o) => (globalThis as unknown as Globals).tr.settings.update({ appearance: { theme: 'dark', terminalOpacity: o } }), OPACITY)
  await expect.poll(() => page.evaluate((id) => (globalThis as unknown as Globals).__trTerminals.info(id)?.allowTransparency, SESSION)).toBe(true)
  // The point of the change: transparency alone no longer drops the terminal to the DOM renderer.
  await expect.poll(renderer).toBe('webgl')
  await page.evaluate((color) => {
    const doc = (globalThis as unknown as { document: Document }).document
    const backdrop = doc.createElement('div')
    backdrop.style.cssText = `position:fixed;inset:0;z-index:-1;background:${color}`
    doc.body.appendChild(backdrop)
  }, BACKDROP)

  // The shell may still be starting and eat the first keystrokes. Prompts differ (zsh themes, bash's `$` on CI), so ask
  // the shell itself: only once it runs commands does `42` show up on a line of its own (the echoed command has `$((6*7))`).
  await expect
    .poll(
      async () => {
        await write('\x15echo shell-$((6*7))\r')
        await page.waitForTimeout(400)
        return screen()
      },
      { timeout: 20_000 }
    )
    .toMatch(/^shell-42$/m)
  // Dim and italic cells, an explicit background, and Chinese, all on one row.
  await write(`clear; printf '\\033[2mdim dim dim\\033[0m \\033[3mitalic italic\\033[0m plain plain \\033[41m red \\033[0m 你好世界\\n'; echo ready-$((40+2))\r`)
  await expect.poll(screen, { timeout: 10_000 }).toMatch(/^ready-42$/m)
  await page.waitForTimeout(500)
  const grid = await geometry(page)
  const row = (await screen()).split('\n').findIndex((line) => line.startsWith('dim dim dim'))
  expect(row, 'the styled line is on screen').toBeGreaterThanOrEqual(0)

  // `red` is where the red cells are drawn, in cells (fractional): the grid's columns, or the DOM span's own box.
  const sample = async (name: string, red: [number, number] = [38, 43]) => {
    const raster = decodePng(await page.screenshot({ path: join(SHOTS, `${name}.png`), clip: grid.clip }))
    return {
      raster,
      plain: modalColor(raster, grid, row, 60, 100),
      dim: modalColor(raster, grid, row, 0, 11),
      italic: modalColor(raster, grid, row, 12, 25),
      red: modalColor(raster, grid, row, red[0], red[1])
    }
  }
  const webgl = await sample('translucent-webgl-dim-italic')
  // The translucent background lets the blue backdrop through, and the dim / italic cells do not hide it.
  expect(webgl.plain[2], 'plain background shows the backdrop').toBeGreaterThan(30)
  expect(near(webgl.dim, webgl.plain, 2), `dim ${webgl.dim} vs plain ${webgl.plain}`).toBe(true)
  expect(near(webgl.italic, webgl.plain, 2), `italic ${webgl.italic} vs plain ${webgl.plain}`).toBe(true)

  // The same screen on the DOM renderer (the fallback) is the reference.
  await page.evaluate((id) => (globalThis as unknown as Globals).__trTerminals.renderer(id, 'dom'), SESSION)
  await expect.poll(renderer).toBe('dom')
  // A slow runner (software GL on CI) takes a while to paint the DOM rows: wait for the styled line in them.
  await expect(page.locator(`[data-region="terminal"] [data-session-id="${SESSION}"] .xterm-rows`)).toContainText('dim dim dim', { timeout: 10_000 })
  await page.waitForTimeout(500)
  // This compares colors, not the grid (cjk-dom-width does that): on CI's runners the DOM renderer spaces glyphs wider
  // than the cells, so the red cells are sampled where its span is drawn.
  // In the screenshot's own pixels (the clip measured on WebGL): the DOM renderer's screen can be wider than the clip.
  const domRed = await page.evaluate(
    ([id, r, left, cell]) => {
      const doc = (globalThis as unknown as { document: Document }).document
      const screen = doc.querySelector(`[data-region="terminal"] [data-session-id="${id}"] .xterm-screen`)!
      const span = Array.from(screen.querySelectorAll('.xterm-rows > div')[r]?.querySelectorAll('span') ?? []).find(
        (el) => el.textContent === ' red '
      )
      if (!span) return null
      const own = span.getBoundingClientRect()
      return [(own.left - left) / cell, (own.right - left) / cell] as [number, number]
    },
    [SESSION, row, grid.clip.x, grid.clip.width / grid.cols] as const
  )
  expect(domRed, 'the DOM renderer drew the red cells in a span of their own').not.toBeNull()
  const dom = await sample('translucent-dom-dim-italic', domRed!)
  for (const key of ['plain', 'dim', 'italic', 'red'] as const) {
    expect(near(webgl[key], dom[key], 3), `${key}: webgl ${webgl[key]} vs dom ${dom[key]} (DOM red at cells ${domRed!.map((c) => c.toFixed(1)).join('–')})`).toBe(true)
  }
  await page.evaluate((id) => (globalThis as unknown as Globals).__trTerminals.renderer(id, 'auto'), SESSION)
  await expect.poll(renderer).toBe('webgl')

  // Wrapped Chinese inside a full-width highlighted block (Claude Code's prompt): every row of the block ends exactly
  // on the last cell, and the cell after the grid is not painted.
  await write(`clear; printf '\\033[48;5;238m%s\\033[K\\033[0m\\n' '${TEXT}'; echo done-$((1+1))\r`)
  await expect.poll(screen, { timeout: 10_000 }).toMatch(/^done-2$/m)
  await page.waitForTimeout(500)
  const cjk = await geometry(page)
  const first = (await screen()).split('\n').findIndex((line) => line.startsWith('现在在worktree'))
  expect(first, 'the highlighted block is on screen').toBeGreaterThanOrEqual(0)
  const raster = decodePng(await page.screenshot({ path: join(SHOTS, 'translucent-webgl-cjk.png'), clip: { ...cjk.clip, x: cjk.clip.x - 6, width: cjk.clip.width + 12 } }))
  const padded: Grid = { ...cjk, clip: { ...cjk.clip, x: cjk.clip.x - 6, width: cjk.clip.width + 12 } }
  const block = near(modalColor(raster, padded, first, 1, 2), [0x44, 0x44, 0x44], 4)
  expect(block, 'the first row is the highlighted block').toBe(true)
  const rowHeight = cjk.clip.height / cjk.rows
  // The block's color is what most of a cell is painted with; one pixel can be a glyph's edge (1x screens on CI).
  const blockColor = modalColor(raster, padded, first, 1, 2)
  let blockRows = 0
  for (let row = first; row < cjk.rows; row++) {
    const y = (row + 0.5) * rowHeight
    if (!near(modalColor(raster, padded, row, 1, 2), blockColor, 2)) break
    blockRows++
    expect(near(pixel(raster, padded, 6 + cjk.clip.width - 2, y), blockColor, 2), `row ${row} reaches the last cell`).toBe(true)
    expect(near(pixel(raster, padded, 6 + cjk.clip.width + 3, y), blockColor, 2), `row ${row} stops at the grid`).toBe(false)
  }
  // The line wraps, so the block spans several rows.
  expect(blockRows).toBeGreaterThan(1)
  expect(blockRows).toBeLessThan(cjk.rows - first)
  await app.close()
})
