// Live status: synthetic agent events (through the __trStatus test seam) must reach the sidebar,
// the header, the Dock badge and the notification path. No real agent is started.
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent } from '../src/shared/agent-events'
import { launchApp } from './launch'

// Fixture sessions (src/renderer/state/mock-data.ts): s-cookie claude, active, running;
// s-perf codex, running; s-nav claude, done_unread; s-acme-main shell, idle;
// s-sidebar claude, running; s-graph claude, error.
interface Calls {
  badge: number[]
  notification: { title: string; body: string; tag: string }[]
}
const WITHIN = { timeout: 1000 }
const SHOTS = join(process.cwd(), 'test-results', 'status')

let app: ElectronApplication
let page: Page

const row = (id: string): Locator => page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`)
const header = () => page.locator('header')
type Method = 'emit' | 'ptyExit' | 'title' | 'advance' | 'setFocused'
const call = (method: Method, ...args: unknown[]) =>
  page.evaluate(
    ([m, a]) => ((globalThis as unknown as { __trStatus: Record<string, (...x: unknown[]) => void> }).__trStatus[m as string] as (...x: unknown[]) => void)(...(a as unknown[])),
    [method, args]
  )
const emit = (id: string, event: AgentEvent) => call('emit', id, event)
const setFocused = (focused: boolean | null) => call('setFocused', focused)
const calls = () =>
  page.evaluate(() => JSON.parse(JSON.stringify((globalThis as unknown as { __trStatus: { calls: Calls } }).__trStatus.calls)) as Calls)
const select = (id: string) => row(id).click()

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true })
  app = await launchApp()
  page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
  })
  await page.reload()
  await page.waitForFunction(() => Boolean((globalThis as unknown as { __trStatus?: unknown }).__trStatus))
  // Pretend the window is focused so results do not depend on the CI desktop.
  await setFocused(true)
})

test.afterAll(async () => {
  await app?.close()
})

test('reports the Dock badge for the sessions that need attention', async () => {
  // Fixtures start with one done_unread and one error session.
  await expect.poll(async () => (await calls()).badge.at(-1), WITHIN).toBe(2)
})

test('a background permission request marks the session in place, badges and notifies', async () => {
  await emit('s-perf', { type: 'tool-start', tool: 'Bash', input: { command: 'pnpm test checkout' } })
  await expect(row('s-perf').getByRole('img', { name: '运行中' })).toBeVisible(WITHIN)
  await expect(row('s-perf')).toContainText('运行 pnpm test checkout', WITHIN)

  await emit('s-perf', { type: 'notification', kind: 'permission', message: 'Claude needs permission' })
  await expect(row('s-perf').getByRole('img', { name: '等你处理' })).toBeVisible(WITHIN)
  await expect(row('s-perf')).toHaveAttribute('data-attention', 'true', WITHIN)
  await expect(row('s-perf')).toContainText('等你确认：运行 pnpm test checkout', WITHIN)

  const seen = await calls()
  expect(seen.badge.at(-1)).toBe(3)
  expect(seen.notification.at(-1)).toEqual({
    title: 'acme-web · 结算页性能优化',
    body: '等你处理 · 等你确认：运行 pnpm test checkout',
    tag: 's-perf'
  })
})

test("the active session's row follows its status (the header no longer repeats it, F17)", async () => {
  await select('s-perf')
  await expect(row('s-perf').getByRole('img', { name: '等你处理' })).toBeVisible(WITHIN)
  // Answered in the TUI: the next tool event puts it back to running.
  await emit('s-perf', { type: 'tool-end', tool: 'Bash', input: {}, ok: true })
  await expect(row('s-perf').getByRole('img', { name: '运行中' })).toBeVisible(WITHIN)
  await expect.poll(async () => (await calls()).badge.at(-1), WITHIN).toBe(2)
})

test('never notifies for the session being looked at', async () => {
  const before = (await calls()).notification.length
  await emit('s-perf', { type: 'notification', kind: 'question', message: 'q' })
  await expect(row('s-perf').getByRole('img', { name: '等你处理' })).toBeVisible(WITHIN)
  await emit('s-perf', { type: 'stop' })
  // Viewed + focused: a finished turn is already seen.
  await expect(row('s-perf').getByRole('img', { name: '空闲' })).toBeVisible(WITHIN)
  expect((await calls()).notification.length).toBe(before)
})

test('opening a done_unread session marks it seen', async () => {
  await expect(row('s-nav').getByRole('img', { name: '已完成' })).toBeVisible()
  await select('s-nav')
  await expect(row('s-nav').getByRole('img', { name: '空闲' })).toBeVisible(WITHIN)
  await expect.poll(async () => (await calls()).badge.at(-1), WITHIN).toBe(1)
})

test('with the window unfocused, even the active session notifies and stays unread', async () => {
  await select('s-cookie')
  await setFocused(false)
  const before = (await calls()).notification.length
  await emit('s-cookie', { type: 'stop', message: '登录流程已经修好' })
  await expect(row('s-cookie').getByRole('img', { name: '已完成' })).toBeVisible(WITHIN)
  // Finished turns are announced a moment later, together with any that finish at the same time.
  await expect.poll(async () => (await calls()).notification.length, { timeout: 3000 }).toBe(before + 1)
  const seen = await calls()
  expect(seen.notification.at(-1)).toMatchObject({ tag: 's-cookie', body: '已完成 · 登录流程已经修好' })
  expect(seen.badge.at(-1)).toBe(2)

  await setFocused(true)
  await expect(row('s-cookie').getByRole('img', { name: '空闲' })).toBeVisible(WITHIN)
  await expect.poll(async () => (await calls()).badge.at(-1), WITHIN).toBe(1)
})

test('stop-failure shows an error with the message', async () => {
  await emit('s-sidebar', { type: 'stop-failure', message: 'API 额度已用完' })
  await expect(row('s-sidebar').getByRole('img', { name: '出错' })).toBeVisible(WITHIN)
  await expect(row('s-sidebar')).toContainText('API 额度已用完', WITHIN)
  await expect.poll(async () => (await calls()).badge.at(-1), WITHIN).toBe(2)
})

test('a non-zero exit while running becomes an error', async () => {
  await call('ptyExit', 's-nav', 0)
  await expect(row('s-nav').getByRole('img', { name: '已退出' })).toBeVisible(WITHIN)
  await emit('s-perf', { type: 'prompt-submit', prompt: 'go' })
  await call('ptyExit', 's-perf', 1)
  await expect(row('s-perf').getByRole('img', { name: '出错' })).toBeVisible(WITHIN)
})

test('self-heals a lost stop when the title shows the agent is idle', async () => {
  // s-graph: error → prompt-submit → running, then the Stop hook never arrives.
  await emit('s-graph', { type: 'prompt-submit', prompt: 'retry' })
  await expect(row('s-graph').getByRole('img', { name: '运行中' })).toBeVisible(WITHIN)
  await call('title', 's-graph', '✳ Claude Code')
  await call('advance', 5_000)
  await expect(row('s-graph').getByRole('img', { name: '运行中' })).toBeVisible()
  await call('advance', 2_000)
  await expect(row('s-graph').getByRole('img', { name: '空闲' })).toBeVisible(WITHIN)
})

test('shell sessions only ever go idle → exited', async () => {
  await emit('s-acme-main', { type: 'prompt-submit', prompt: 'x' })
  await emit('s-acme-main', { type: 'stop-failure' })
  await expect(row('s-acme-main').getByRole('img', { name: '空闲' })).toBeVisible()
  await call('ptyExit', 's-acme-main', 0)
  await expect(row('s-acme-main').getByRole('img', { name: '已退出' })).toBeVisible(WITHIN)
})

test('clicking a notification activates its session', async () => {
  await select('s-cookie')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('ui:notification-click', 's-sidebar')
  })
  await expect(row('s-sidebar')).toHaveAttribute('aria-current', 'true', WITHIN)
  await expect(header()).toContainText('侧边栏状态聚合', WITHIN)
})

test('with the sidebar hidden, the header says how many sessions need you and opens the overview', async () => {
  await page.getByRole('button', { name: '隐藏侧栏' }).click()
  const hint = header().getByRole('button', { name: /个会话需要你/ })
  await expect(hint).toBeVisible(WITHIN)
  const badge = (await calls()).badge.at(-1)
  await expect(hint).toHaveText(`${badge} 个会话需要你`)
  await page.screenshot({ path: join(SHOTS, 'collapsed-waiting.png') })
  await hint.click()
  await expect(page.locator('[data-region="overview"]')).toBeVisible(WITHIN)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '显示侧栏' }).first().click()
  await expect(row('s-cookie')).toBeVisible(WITHIN)
})

test('screenshots: queue and header in both themes', async () => {
  // Fresh fixtures: earlier tests ended some sessions.
  await page.reload()
  await page.waitForFunction(() => Boolean((globalThis as unknown as { __trStatus?: unknown }).__trStatus))
  await setFocused(true)
  await emit('s-cookie', { type: 'tool-start', tool: 'Edit', input: { file_path: '/repo/src/auth/session.ts' } })
  await emit('s-perf', { type: 'tool-start', tool: 'Bash', input: { command: 'pnpm test checkout' } })
  await emit('s-perf', { type: 'notification', kind: 'permission', message: 'm' })
  await expect(row('s-cookie')).toContainText('编辑 session.ts', WITHIN)
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((t) => {
      ;(globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.theme = t
    }, theme)
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(SHOTS, `status-${theme}.png`) })
  }
})
