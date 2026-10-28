// Regression: on the DOM renderer (translucent terminals used it before they moved to WebGL; it is still the fallback
// when WebGL is unavailable) a wrapped Chinese line must stay inside the cell grid.
// xterm sizes each glyph by measuring it repeated 32 times and pads it to its cells with letter-spacing. Chromium's
// default `text-spacing-trim` halves fullwidth punctuation next to more of it, so ，；measured 6.7px instead of 13px
// and each one then rendered ~0.8 cell too wide: highlighted blocks (Claude Code's prompt) got a ragged right edge,
// and with rows clipped to the grid the last glyph was cut in half (PRD §6.3).
import { expect, test } from '@playwright/test'
import { launchApp } from './launch'

const SESSION = 's-cookie'
/** The line that showed it: CJK, Latin and two fullwidth punctuation marks per wrapped row. */
const TEXT =
  '现在在worktree这里，点击打开一个worktree的详情之后就没办法收起，只能点击另一个才行但是另一个又打开并且不能收起来了；所以我希望新增一个可以单击之后收起的小feature'

interface Globals {
  __TR_E2E__: boolean
  __trTerminals: {
    readScreen(id: string, scrollbackLines?: number): string
    info(id: string): { renderer: 'webgl' | 'dom'; cols: number } | null
    renderer(id: string, mode: 'auto' | 'dom'): void
  }
  tr: { pty: { write(id: string, data: string): void }; settings: { update(patch: unknown): Promise<unknown> } }
}

interface RowMeasure {
  text: string
  gridWidth: number
  /** Right edge of the row's painted content, relative to the row. */
  contentRight: number
  /** Widest single CJK glyph cell: a 2-cell glyph's span width over its character count. */
  cjkCellPairs: number[]
}

test('wrapped Chinese text stays on the cell grid on the DOM renderer', async () => {
  test.setTimeout(60_000)
  const app = await launchApp()
  const page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as Globals).__TR_E2E__ = true
  })
  await page.reload()
  const screen = () => page.evaluate((id) => (globalThis as unknown as Globals).__trTerminals.readScreen(id, 0), SESSION)
  await expect.poll(screen, { timeout: 20_000 }).not.toBe('')

  await page.evaluate(() => (globalThis as unknown as Globals).tr.settings.update({ appearance: { theme: 'dark', terminalOpacity: 0.8 } }))
  // Translucent terminals draw with WebGL now; force the fallback this spec is about.
  await expect.poll(() => page.evaluate((id) => (globalThis as unknown as Globals).__trTerminals.info(id)?.renderer, SESSION)).toBe('webgl')
  await page.evaluate((id) => (globalThis as unknown as Globals).__trTerminals.renderer(id, 'dom'), SESSION)
  await expect.poll(() => page.evaluate((id) => (globalThis as unknown as Globals).__trTerminals.info(id)?.renderer, SESSION)).toBe('dom')

  // A full-width highlighted block, like Claude Code's user prompt: background on every cell, \e[K to the edge.
  await page.evaluate(
    ([id, text]) =>
      (globalThis as unknown as Globals).tr.pty.write(id!, `clear; printf '\\033[48;5;238m%s\\033[K\\033[0m\\n' '${text}'; echo done-$((1+1))\r`),
    [SESSION, TEXT]
  )
  await expect.poll(screen, { timeout: 10_000 }).toMatch(/^done-2$/m)
  await page.waitForTimeout(300)

  const { cols, rows } = await page.evaluate((id) => {
    const doc = (globalThis as unknown as { document: Document }).document
    const host = doc.querySelector(`[data-region="terminal"] [data-session-id="${id}"]`)!
    const cols = (globalThis as unknown as Globals).__trTerminals.info(id)!.cols
    const measures: RowMeasure[] = []
    for (const row of host.querySelectorAll<HTMLElement>('.xterm-rows > div')) {
      const box = row.getBoundingClientRect()
      const spans = [...row.querySelectorAll('span')]
      if (spans.length === 0) continue
      measures.push({
        text: row.textContent ?? '',
        gridWidth: box.width,
        contentRight: Math.max(...spans.map((s) => s.getBoundingClientRect().right - box.left)),
        cjkCellPairs: spans
          .filter((s) => /^[\p{Script=Han}\u3000-\u303f\uff00-\uffef]+$/u.test(s.textContent ?? ''))
          .map((s) => s.getBoundingClientRect().width / (s.textContent ?? '').length)
      })
    }
    return { cols, rows: measures }
  }, SESSION)

  const block = rows.filter((r) => /\p{Script=Han}/u.test(r.text))
  // The line wraps, and at least one wrapped row carries the fullwidth punctuation that used to drift.
  expect(block.length).toBeGreaterThan(0)
  expect(block.some((r) => /[，；]/.test(r.text))).toBe(true)
  const cell = block[0]!.gridWidth / cols
  for (const row of block) {
    // Every row ends on the grid: no ragged background, nothing for the row's clip to cut.
    expect(row.contentRight, row.text).toBeLessThanOrEqual(row.gridWidth + 0.5)
    // And every CJK glyph, punctuation included, takes exactly two cells.
    for (const pair of row.cjkCellPairs) expect(pair, row.text).toBeCloseTo(2 * cell, 1)
  }
  await app.close()
})
