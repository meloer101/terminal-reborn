// Status overview (PRD F9 · Figma 11 / 11b / 11c) over the fixture workspace: open it from the sidebar and
// with ⌘⇧A, groups by status, keyboard selection, preview with an injected permission prompt, board view,
// and back to a session. Screenshots of the list, the board and the preview in both themes.
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
const peek = () => page.locator('[data-region="overview-peek"]')
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
  // Group order is fixed: answer, fix, review, watch, ignore.
  const labels = await overview().locator('section > button h2').allTextContents()
  expect(labels).toEqual(['等你处理', '出错', '待审阅', '运行中', '空闲'])
})

test('a waiting permission moves the session to 等你处理; the preview shows its terminal and leads into it', async () => {
  await page.evaluate(() =>
    (globalThis as unknown as { __trStatus: { emit(id: string, e: unknown): void } }).__trStatus.emit('s-perf', {
      type: 'notification',
      kind: 'permission',
      message: 'Codex needs permission'
    })
  )
  await expect(group('等你处理').locator('[data-session-id="s-perf"]')).toBeVisible()
  await expect(row('s-perf')).toContainText('等你处理')

  await row('s-perf').click()
  await expect(peek()).toBeVisible()
  await expect(peek()).toContainText('结算页性能优化')
  await expect(peek().getByTestId('peek-snapshot')).toBeVisible()
  await expect(peek().getByRole('button', { name: /进入会话/ })).toBeVisible()
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(theme)
    await page.waitForTimeout(120)
    await page.screenshot({ path: join(SHOTS, `peek-${theme}.png`) })
  }
  await setTheme('dark')
  await page.keyboard.press('Escape')
  await expect(peek()).toBeHidden()
  await expect(overview()).toBeVisible()
})

test('keyboard: ↓ moves, Space previews, filter narrows, board shows the same groups', async () => {
  await overview().locator('[role="listbox"]').focus()
  const first = await overview().locator('[aria-selected="true"]').getAttribute('data-session-id')
  await page.keyboard.press('ArrowDown')
  const second = await overview().locator('[aria-selected="true"]').getAttribute('data-session-id')
  expect(second).not.toBe(first)
  await page.keyboard.press('Space')
  await expect(peek()).toBeVisible()
  await page.keyboard.press('Escape')

  // Space on a focused group header folds the group instead of previewing.
  await overview().locator('section[aria-label="空闲"] > button').focus()
  await page.keyboard.press('Space')
  await expect(overview().locator('section[aria-label="空闲"] > button')).toHaveAttribute('aria-expanded', 'false')
  await expect(peek()).toBeHidden()
  await page.keyboard.press('Space')
  await expect(overview().locator('section[aria-label="空闲"] > button')).toHaveAttribute('aria-expanded', 'true')

  await overview().getByRole('searchbox', { name: '过滤会话' }).fill('p:terminal')
  await expect(overview().locator('[role="option"]')).toHaveCount(2)
  await overview().getByRole('searchbox', { name: '过滤会话' }).fill('')

  for (const theme of ['dark', 'light'] as const) {
    await setTheme(theme)
    await page.waitForTimeout(120)
    await page.screenshot({ path: join(SHOTS, `list-${theme}.png`) })
  }
  await overview().getByRole('radio', { name: '看板' }).click()
  await expect(overview().locator('section[aria-label="运行中"] [role="option"]')).toHaveCount(2)
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(theme)
    await page.waitForTimeout(120)
    await page.screenshot({ path: join(SHOTS, `board-${theme}.png`) })
  }
  await setTheme('dark')
  await overview().getByRole('radio', { name: '列表' }).click()
})

test('↵ enters the selected session; ⌘⇧A toggles the overview', async () => {
  await row('s-graph').click()
  await page.keyboard.press('Escape') // close the preview the click opened
  await overview().locator('[role="listbox"]').focus()
  await page.keyboard.press('Enter')
  await expect(overview()).toBeHidden()
  await expect(page.locator('[data-region="terminal"]')).toBeVisible()
  await expect(page.locator('[data-region="sidebar"] [data-session-id="s-graph"]')).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('Meta+Shift+A')
  await expect(overview()).toBeVisible()
  await page.keyboard.press('Meta+Shift+A')
  await expect(overview()).toBeHidden()
})
