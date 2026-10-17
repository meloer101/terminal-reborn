// An errored session says what went wrong and offers the next step (phase 2b): fixture `s-graph` is in error.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp } from './launch'

interface Hook {
  readScreen(sessionId: string, scrollbackLines?: number): string
}
const ERRORED = 's-graph'

let app: ElectronApplication
let page: Page

const bar = () => page.getByTestId('session-error')
const screen = (id: string) =>
  page.evaluate((s) => (globalThis as unknown as { __trTerminals: Hook }).__trTerminals.readScreen(s, 50), id)
const setTheme = (theme: 'dark' | 'light') =>
  page.evaluate((t) => {
    ;(globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.theme = t
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
  await expect(page.locator('[data-region="sidebar"]')).toBeVisible()
})

test.afterAll(async () => {
  await app.close()
})

test('a healthy session shows no error bar', async () => {
  await expect(page.locator('[data-region="terminal"] [data-active="true"]')).toBeVisible()
  await expect(bar()).toHaveCount(0)
})

test('an errored session names the error and offers 让 agent 修复 and a retry', async () => {
  await page.locator(`[data-region="sidebar"] [data-session-id="${ERRORED}"]`).click()
  await expect(bar()).toBeVisible()
  await expect(bar()).toContainText('pnpm build 失败 · 2 个错误')
  await expect(bar().getByRole('button', { name: '让 agent 修复' })).toBeEnabled()
  await expect(bar().getByRole('button', { name: '重试这一轮' })).toBeEnabled()
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(theme)
    await page.waitForTimeout(150)
    await page.screenshot({ path: `test-results/session-error-${theme}.png` })
  }
  await setTheme('dark')
})

test('让 agent 修复 types the error into the session with the send protocol', async () => {
  await expect.poll(() => screen(ERRORED), { timeout: 20_000 }).not.toBe('')
  await bar().getByRole('button', { name: '让 agent 修复' }).click()
  // The fixture runs a shell, so the prompt lands as a (failing) command line: what matters is that it arrived.
  await expect.poll(() => screen(ERRORED), { timeout: 10_000 }).toContain('请先找出原因并修复')
  await expect(bar()).not.toContainText('没能完成')
})
