// Status overview (PRD F9 · Figma 11 v2) over the fixture workspace: open it from the sidebar and with ⌘⇧A, groups
// by status, keyboard selection, the session's own terminal expanded in place under a list row, the board's status
// cards and session overlay, and back to a session. Screenshots of every state in both themes.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'overview')

let app: ElectronApplication
let page: Page

const overview = () => page.locator('[data-region="overview"]')
const group = (label: string) => overview().locator(`section[aria-label="${label}"]`)
const row = (id: string) => overview().locator(`[data-session-id="${id}"]`)
const tray = () => overview().locator('[role="group"]')
const overlay = () => page.locator('[data-region="overview-overlay"]')
/** The session's pane in the main area, where its terminal lives when the overview is not showing it. */
const homePane = (id: string) => page.locator(`[data-region="terminal"] [data-session-id="${id}"]`)
const shoot = async (name: string) => {
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(theme)
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) })
  }
  await setTheme('dark')
}
const navEntry = () => page.locator('[data-region="sidebar"]').getByRole('button', { name: /^总览/ })
const setTheme = (theme: 'dark' | 'light') =>
  page.evaluate((t) => {
    ;(globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.theme = t
  }, theme)

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true })
  app = await launchApp()
  page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
    // Start from the default view every run.
    globalThis.localStorage?.removeItem('tr.overview.v1')
  })
  await page.reload()
  await page.waitForFunction(() => Boolean((globalThis as unknown as { __trStatus?: unknown }).__trStatus))
})

test.afterAll(async () => {
  await app?.close()
})

test('the sidebar entry shows how many sessions need you and opens the overview', async () => {
  // Fixtures: s-nav done_unread and s-graph error need attention.
  await expect(navEntry()).toContainText('2')
  await navEntry().click()
  await expect(overview()).toBeVisible()
  await expect(navEntry()).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-region="terminal"]')).toBeHidden()
  await expect(overview().getByRole('heading', { name: '总览', level: 1 })).toBeVisible()
})

test('groups sessions by what they need, across projects', async () => {
  await expect(group('出错').locator('[data-session-id]')).toHaveCount(1)
  await expect(row('s-graph')).toContainText('出错')
  await expect(row('s-graph')).toContainText('terminal-reborn › jacob/graph-layout')
  await expect(group('待审阅')).toContainText('修复移动端导航抖动')
  await expect(group('运行中').locator('[data-session-id]')).toHaveCount(3)
  // Group order is fixed: answer, fix, review, watch, ignore. Empty groups (等你处理 here) are left out of the list.
  const labels = await overview().locator('section > button h2').allTextContents()
  expect(labels).toEqual(['出错', '待审阅', '运行中', '空闲'])
})

test('a waiting permission moves the session to 等你处理; a click expands its own terminal in place', async () => {
  await page.evaluate(() =>
    (globalThis as unknown as { __trStatus: { emit(id: string, e: unknown): void } }).__trStatus.emit('s-perf', {
      type: 'notification',
      kind: 'permission',
      message: 'Codex needs permission'
    })
  )
  await expect(group('等你处理').locator('[data-session-id="s-perf"]')).toBeVisible()
  await expect(row('s-perf')).toContainText('等你处理')
  await expect(row('s-perf')).toHaveCSS('height', '40px')

  await row('s-perf').click()
  await expect(tray()).toHaveCount(1)
  await expect(row('s-perf')).toHaveAttribute('aria-expanded', 'true')
  await expect(tray().getByRole('button', { name: /进入会话/ })).toBeVisible()
  await expect(row('s-perf')).not.toContainText('+128')
  // The same xterm, moved out of its pane — not a second terminal.
  await expect(tray().locator('[data-overview-terminal] .xterm')).toHaveCount(1)
  await expect(homePane('s-perf').locator('.xterm')).toHaveCount(0)
  const box = await tray().locator('[data-overview-terminal]').boundingBox()
  expect(Math.round(box?.height ?? 0)).toBe(420)
  await shoot('list-expanded')

  // It is the live terminal: typing reaches the session's PTY, and Esc typed there stays with the terminal.
  await tray().locator('[data-overview-terminal]').click()
  await page.keyboard.type('echo tr-overview-$((40+2))')
  await page.keyboard.press('Enter')
  await expect
    .poll(() =>
      page.evaluate(() =>
        (globalThis as unknown as { __trTerminals: { readScreen(id: string, n?: number): string } }).__trTerminals.readScreen('s-perf', 40)
      )
    )
    .toContain('tr-overview-42')
  await page.keyboard.press('Escape')
  await expect(tray()).toHaveCount(1)

  // One row at a time: opening another closes the first.
  await row('s-graph').click()
  await expect(tray()).toHaveCount(1)
  await expect(row('s-graph')).toHaveAttribute('aria-expanded', 'true')
  await tray().getByRole('button', { name: '收起' }).click()
  await expect(tray()).toHaveCount(0)
  await expect(overview()).toBeVisible()
})

test('keyboard: ↓ moves, Space expands, Esc collapses, filter narrows', async () => {
  await overview().locator('[role="listbox"]').focus()
  const first = await overview().locator('[aria-selected="true"]').getAttribute('data-session-id')
  await page.keyboard.press('ArrowDown')
  const second = await overview().locator('[aria-selected="true"]').getAttribute('data-session-id')
  expect(second).not.toBe(first)
  await page.keyboard.press('Space')
  await expect(tray()).toHaveCount(1)
  await expect(row(second ?? '')).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(tray()).toHaveCount(0)
  await expect(overview()).toBeVisible()

  // Space on a focused group header folds the group instead of expanding a row.
  await overview().locator('section[aria-label="空闲"] > button').focus()
  await page.keyboard.press('Space')
  await expect(overview().locator('section[aria-label="空闲"] > button')).toHaveAttribute('aria-expanded', 'false')
  await expect(tray()).toHaveCount(0)
  await page.keyboard.press('Space')
  await expect(overview().locator('section[aria-label="空闲"] > button')).toHaveAttribute('aria-expanded', 'true')

  await overview().getByRole('searchbox', { name: '过滤会话' }).fill('p:terminal')
  await expect(overview().locator('[role="option"]')).toHaveCount(2)
  await overview().getByRole('searchbox', { name: '过滤会话' }).fill('')
  await overview().locator('[role="listbox"]').focus()
  await shoot('list')
})

test('board: status cards; a card opens the session in an overlay that Esc, the scrim and × close', async () => {
  await overview().getByRole('radio', { name: '看板' }).click()
  await expect(overview().locator('section[aria-label="运行中"] [role="option"]')).toHaveCount(2)
  await expect(row('s-graph')).toHaveAttribute('data-card', 'error')
  await shoot('board')

  await row('s-graph').click()
  await expect(overlay().getByRole('dialog', { name: 'Git 图谱布局算法' })).toBeVisible()
  await expect(overlay()).toContainText('terminal-reborn › jacob/graph-layout')
  await expect(overlay().locator('[data-overview-terminal] .xterm')).toHaveCount(1)
  await expect(homePane('s-graph').locator('.xterm')).toHaveCount(0)
  await shoot('board-overlay')
  await page.keyboard.press('Escape')
  await expect(overlay()).toBeHidden()
  await expect(overview()).toBeVisible()

  await row('s-graph').click()
  await expect(overlay()).toBeVisible()
  await overlay().click({ position: { x: 4, y: 4 } })
  await expect(overlay()).toBeHidden()

  await row('s-graph').click()
  await overlay().getByRole('button', { name: '关闭' }).click()
  await expect(overlay()).toBeHidden()
})

test('board overlay tiles up to four sessions side by side', async () => {
  const terminals = () => overlay().locator('[data-overview-terminal] .xterm')
  const add = () => overlay().getByRole('button', { name: '并排添加会话' })
  const pick = (n: number) => overlay().locator('[data-pick-id]').nth(n)

  await row('s-graph').click()
  await add().click()
  await expect(overlay().getByRole('region', { name: '添加会话' })).toBeVisible()
  await shoot('board-overlay-picker')
  await pick(0).click()
  await expect(terminals()).toHaveCount(2)
  await add().click()
  await pick(0).click()
  await expect(terminals()).toHaveCount(3)
  await add().click()
  await pick(0).click()
  await expect(terminals()).toHaveCount(4)
  // Four is the most: no more add button.
  await expect(add()).toHaveCount(0)
  await shoot('board-overlay-four')

  await overlay().locator('[data-pane-id]').last().getByRole('button', { name: '关闭' }).click()
  await expect(terminals()).toHaveCount(3)
  await expect(add()).toHaveCount(1)

  // Three windows: two stacked on the left (the fourth closed), one tall on the right. Drag the top-left one onto the
  // right one's middle: they swap, so it takes the right column.
  const pane = (n: number) => overlay().locator('[data-pane-id]').nth(n)
  const boxOf = async (n: number) => {
    const b = await pane(n).boundingBox()
    if (!b) throw new Error('no box')
    return b
  }
  const left = await boxOf(0)
  const right = await boxOf(2)
  const leftId = await pane(0).getAttribute('data-pane-id')
  await page.mouse.move(left.x + 40, left.y + 24)
  await page.mouse.down()
  await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2, { steps: 8 })
  await shoot('board-overlay-drag')
  await page.mouse.up()
  const moved = overlay().locator(`[data-pane-id="${leftId}"]`)
  await expect.poll(async () => (await moved.boundingBox())?.x).toBeCloseTo(right.x, 0)
  await expect.poll(async () => (await moved.boundingBox())?.y).toBeCloseTo(right.y, 0)

  // The gap between the columns resizes them.
  const split = overlay().getByRole('separator', { name: '调整宽度' })
  const s = await split.boundingBox()
  if (!s) throw new Error('no split')
  const before = (await boxOf(0)).width
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2)
  await page.mouse.down()
  await page.mouse.move(s.x + s.width / 2 + 120, s.y + s.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await boxOf(0)).width).toBeCloseTo(before + 120, 0)
  await shoot('board-overlay-resized')

  // The gap between the two stacked windows on the left changes their heights.
  const rowSplit = overlay().getByRole('separator', { name: '调整高度' })
  const r = await rowSplit.boundingBox()
  if (!r) throw new Error('no row split')
  const topBefore = (await boxOf(0)).height
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
  await page.mouse.down()
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2 - 80, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await boxOf(0)).height).toBeCloseTo(topBefore - 80, 0)

  // Each edge of the overlay moves on its own: the right edge 100 to the left narrows it by 100, the left edge stays.
  const panel = overlay().getByRole('dialog')
  const p = await panel.boundingBox()
  if (!p) throw new Error('no panel')
  await page.mouse.move(p.x + p.width, p.y + p.height / 2)
  await page.mouse.down()
  await page.mouse.move(p.x + p.width - 100, p.y + p.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await panel.boundingBox())?.width).toBeCloseTo(p.width - 100, 0)
  await expect.poll(async () => (await panel.boundingBox())?.x).toBeCloseTo(p.x, 0)
  await shoot('board-overlay-smaller')
  // Double-clicking an edge restores the default.
  await overlay().locator('[data-edge="e"]').dblclick()
  await expect.poll(async () => (await panel.boundingBox())?.width).toBeCloseTo(p.width, 0)
  await overlay().getByRole('dialog').focus()
  await page.keyboard.press('Escape')
  await expect(overlay()).toBeHidden()
  // Every borrowed terminal went back home.
  await expect(page.locator('[data-region="terminal"] .xterm')).not.toHaveCount(0)
  await overview().getByRole('radio', { name: '列表' }).click()
})

test('↵ enters the selected session; ⌘⇧A toggles the overview', async () => {
  await row('s-graph').click()
  await expect(tray()).toHaveCount(1)
  await overview().locator('[role="listbox"]').focus()
  await page.keyboard.press('Enter')
  await expect(overview()).toBeHidden()
  await expect(page.locator('[data-region="terminal"]')).toBeVisible()
  // The terminal went back to its own pane.
  await expect(homePane('s-graph').locator('.xterm')).toHaveCount(1)
  await expect(page.locator('[data-region="sidebar"] [data-session-id="s-graph"]')).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('Meta+Shift+A')
  await expect(overview()).toBeVisible()
  await page.keyboard.press('Meta+Shift+A')
  await expect(overview()).toBeHidden()
})
