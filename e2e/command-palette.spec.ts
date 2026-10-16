import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp } from './launch'

const FIRST = 's-cookie'
const SECOND = 's-perf' // 结算页性能优化

let app: ElectronApplication
let page: Page

const pane = (sessionId: string) => page.locator(`[data-region="terminal"] [data-session-id="${sessionId}"]`)
const sidebarRow = (sessionId: string) => page.locator(`[data-region="sidebar"] [data-session-id="${sessionId}"]`)
const palette = () => page.getByTestId('command-palette')
const paletteInput = () => palette().getByRole('combobox')

/** Which terminal pane (if any) currently holds keyboard focus. */
const focusedPane = () =>
  page.evaluate(() => {
    const doc = (globalThis as unknown as { document: { activeElement: { closest(s: string): { dataset: Record<string, string> } | null } | null } }).document
    return doc.activeElement?.closest('[data-region="terminal"] [data-session-id]')?.dataset.sessionId ?? null
  })

const setTheme = (theme: 'dark' | 'light') =>
  page.evaluate((t) => {
    const doc = (globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document
    doc.documentElement.dataset.theme = t
  }, theme)

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

test.beforeAll(async () => {
  app = await launchApp()
  page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
  })
  await page.reload()
  await expect(pane(FIRST)).toBeVisible()
  await pane(FIRST).click()
  await expect.poll(focusedPane, { timeout: 10_000 }).toBe(FIRST)
})

test.afterAll(async () => {
  await app.close()
})

test('⌘K opens while the terminal has focus; Esc closes and restores that focus', async () => {
  await expect(palette()).toHaveCount(0)
  await page.keyboard.press('Meta+k')
  await expect(palette()).toBeVisible()
  await expect(paletteInput()).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(palette()).toHaveCount(0)
  await expect.poll(focusedPane).toBe(FIRST)

  // Toggle with the same shortcut.
  await page.keyboard.press('Meta+k')
  await expect(palette()).toBeVisible()
  await page.keyboard.press('Meta+k')
  await expect(palette()).toHaveCount(0)
  await expect.poll(focusedPane).toBe(FIRST)
})

test('empty query lists sessions by urgency, then actions; screenshots in both themes', async () => {
  await page.keyboard.press('Meta+k')
  await expect(palette()).toBeVisible()
  const options = palette().getByRole('option')
  // Fixture order: error, done_unread, running (by recency), idle; then actions.
  await expect(options.first()).toContainText('Git 图谱布局算法')
  await expect(palette().getByText('操作', { exact: true })).toBeVisible()
  await expect(palette().getByRole('option', { name: /新建 Claude 会话/ })).toBeVisible()
  await expect(palette().getByRole('option', { name: /主题：浅色/ })).toBeVisible()

  for (const theme of ['dark', 'light'] as const) {
    await setTheme(theme)
    await page.waitForTimeout(200)
    await page.screenshot({ path: `test-results/command-palette-${theme}.png` })
  }
  await paletteInput().fill('会话')
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme)
    await page.waitForTimeout(200)
    await page.screenshot({ path: `test-results/command-palette-query-${theme}.png` })
  }
  await page.keyboard.press('Escape')
  await expect(palette()).toHaveCount(0)
})

test('typing filters (CJK) and ↵ switches the active session', async () => {
  await page.keyboard.press('Meta+k')
  await paletteInput().fill('结页') // subsequence over 结算页性能优化
  await expect(palette().getByRole('option')).toHaveCount(1)
  await expect(palette().getByRole('option').first()).toContainText('结算页性能优化')

  await page.keyboard.press('Enter')
  await expect(palette()).toHaveCount(0)
  await expect(sidebarRow(SECOND)).toHaveAttribute('aria-current', 'true')
  // Focus lands in the newly active terminal, not on the hidden one.
  await expect.poll(focusedPane).toBe(SECOND)
})

test('↑/↓ move the selection and hover follows the mouse', async () => {
  await page.keyboard.press('Meta+k')
  const options = palette().getByRole('option')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp') // wraps to the last entry
  await expect(options.last()).toHaveAttribute('aria-selected', 'true')
  await options.nth(2).hover()
  await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect.poll(focusedPane).toBe(SECOND)
})

test('Enter while an IME composition is active does nothing', async () => {
  await page.keyboard.press('Meta+k')
  await paletteInput().fill('结算')
  await paletteInput().evaluate((el) => {
    const input = el as unknown as { dispatchEvent(e: unknown): void }
    const Ctor = (globalThis as unknown as { KeyboardEvent: new (t: string, i: object) => unknown }).KeyboardEvent
    input.dispatchEvent(new Ctor('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
    input.dispatchEvent(new Ctor('keydown', { key: 'Process', keyCode: 229, bubbles: true, cancelable: true }))
  })
  await expect(palette()).toBeVisible()
  await page.keyboard.press('Escape')
})

test('⌘K also works from the terminal, and an action runs (theme)', async () => {
  await page.locator('[data-region="terminal"] [data-active="true"]').click() // focus the terminal
  await page.keyboard.press('Meta+k')
  await expect(palette()).toBeVisible()
  await paletteInput().fill('主题 浅色')
  await expect(palette().getByRole('option').first()).toContainText('主题：浅色')
  await page.keyboard.press('Enter')
  await expect(palette()).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => (globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.theme))
    .toBe('light')
})

test('shows an empty state and clicking the scrim closes', async () => {
  await page.keyboard.press('Meta+k')
  await paletteInput().fill('qqqq')
  await expect(palette().getByText('没有匹配项')).toBeVisible()
  await page.mouse.click(8, 8)
  await expect(palette()).toHaveCount(0)
})
