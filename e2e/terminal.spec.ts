import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp } from './launch'

interface Hook {
  readScreen(sessionId: string, scrollbackLines?: number): string
  size(sessionId: string): { cols: number; rows: number } | null
}
const FIRST = 's-cookie'
const SECOND = 's-perf'

let app: ElectronApplication
let page: Page

/** The terminal pane (sidebar rows carry the same data-session-id). */
const pane = (sessionId: string) => page.locator(`[data-region="terminal"] [data-session-id="${sessionId}"]`)

const screen = (sessionId: string, scrollback = 0) =>
  page.evaluate(
    ([id, n]) => (globalThis as unknown as { __trTerminals: Hook }).__trTerminals.readScreen(id as string, n as number),
    [sessionId, scrollback]
  )

const size = (sessionId: string) =>
  page.evaluate((id) => (globalThis as unknown as { __trTerminals: Hook }).__trTerminals.size(id), sessionId)

const setTheme = (theme: 'dark' | 'light') =>
  page.evaluate((t) => {
    const doc = (globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document
    doc.documentElement.dataset.theme = t
  }, theme)

async function run(sessionId: string, command: string): Promise<void> {
  await pane(sessionId).click()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

test.beforeAll(async () => {
  app = await launchApp()
  page = await app.firstWindow()
  // Opt in to the screen-reading hook, then reload so it exists before the renderer boots.
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
  })
  await page.reload()
  await expect(pane(FIRST)).toBeVisible()
  // A prompt (any output at all) means the login shell is up.
  await expect.poll(() => screen(FIRST), { timeout: 20_000 }).not.toBe('')
})

test.afterAll(async () => {
  await app.close()
})

test('typing echo hello shows hello on the screen', async () => {
  await run(FIRST, 'echo hello')
  await expect.poll(() => screen(FIRST), { timeout: 10_000 }).toMatch(/^hello$/m)
})

test('CJK output and a colour sample render; screenshots in both themes', async () => {
  await run(FIRST, `clear; printf '0123456789\\n你好世界\\n\\033[32mgreen\\033[0m \\033[31mred\\033[0m \\033[34mblue\\033[0m\\n'; echo ready-$((40+2))`)
  await expect.poll(() => screen(FIRST), { timeout: 10_000 }).toMatch(/^ready-42$/m)
  expect(await screen(FIRST)).toContain('你好世界')

  for (const theme of ['dark', 'light'] as const) {
    await setTheme(theme)
    await page.waitForTimeout(300)
    await page.screenshot({ path: `test-results/terminal-${theme}.png` })
  }
  await setTheme('dark')
})

test('switching sessions keeps each terminal alive with its own scrollback', async () => {
  await run(FIRST, 'echo marker-one')
  await expect.poll(() => screen(FIRST), { timeout: 10_000 }).toMatch(/^marker-one$/m)

  await page.getByText('结算页性能优化').click()
  await expect(pane(FIRST)).toBeHidden()
  await expect.poll(() => screen(SECOND), { timeout: 20_000 }).not.toBe('')
  await run(SECOND, 'echo marker-two')
  await expect.poll(() => screen(SECOND), { timeout: 10_000 }).toMatch(/^marker-two$/m)

  await page.getByText('Cookie 会话迁移').click()
  await expect(pane(FIRST)).toBeVisible()
  const first = await screen(FIRST, 500)
  expect(first).toMatch(/^marker-one$/m)
  expect(first).not.toContain('marker-two')
  expect(await screen(SECOND, 500)).toMatch(/^marker-two$/m)
  await page.screenshot({ path: 'test-results/terminal-switch-back.png' })
})

test('resizing the window reflows the terminal', async () => {
  const before = await size(FIRST)
  // Shrink relative to the current size: CI displays can be smaller than the default 1440×900 window.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const [width = 1440, height = 900] = win?.getSize() ?? []
    win?.setSize(Math.max(960, width - 300), Math.max(600, height - 100))
  })
  await expect.poll(async () => (await size(FIRST))?.cols).toBeLessThan(before?.cols ?? 0)
  // The shell sees the new size too.
  await run(FIRST, 'clear; echo cols-$(tput cols)')
  const cols = (await size(FIRST))?.cols
  await expect.poll(() => screen(FIRST), { timeout: 10_000 }).toMatch(new RegExp(`^cols-${cols}$`, 'm'))
})

test('a 10 MB flood does not freeze the UI', async () => {
  await run(FIRST, 'clear; yes 0123456789abcdef | head -c 10485760; echo; echo flood-$((1+1))')

  // While output streams in, round trips into the renderer must stay snappy.
  let worst = 0
  const deadline = Date.now() + 40_000
  let done = false
  while (!done && Date.now() < deadline) {
    const started = Date.now()
    const text = await screen(FIRST)
    worst = Math.max(worst, Date.now() - started)
    done = /^flood-2$/m.test(text)
    await page.waitForTimeout(100)
  }
  expect(done).toBe(true)
  expect(worst).toBeLessThan(1500)
})
