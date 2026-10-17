// F17 right panel · 浏览器: the empty state, typing a port to open a local server, isolation of the page from the
// app (no window.tr, no Node), console error counting, the page following the well and hiding under dialogs, the
// mobile viewport, a port found in the session's PTY tree (F14, minimal), and refusing non-http schemes.
// Screenshots of the app window (chrome only; the page is a native view) go to test-results/browser-panel/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'browser-panel')
const SESSION = 's-browser'

// With the viewport meta, the mobile viewport lays the page out 375 wide (without it, 980, as on a real phone).
const PAGE = `<!doctype html><title>e2e page</title><meta name="viewport" content="width=device-width">
<body style="margin:0;font:16px sans-serif"><h1>hello from e2e</h1>
<script>console.warn('careful'); console.error('boom on load')</script></body>`

function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolve) => server.listen(port, () => resolve((server.address() as AddressInfo).port)))
}

/** A port nothing listens on right now. */
async function freePort(): Promise<number> {
  const probe = createServer()
  const port = await listen(probe)
  await new Promise((resolve) => probe.close(resolve))
  return port
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

test.describe('F17 right panel · 浏览器', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-browser-'))
  const project = mkdtempSync(join(tmpdir(), 'tr-e2e-browser-project-'))
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(PAGE)
  })
  let port = 0
  let app: ElectronApplication
  let page: Page

  const panel = () => page.locator('[data-region="panel"]')
  const address = () => panel().getByRole('textbox', { name: '地址' })
  const consoleRow = () => panel().getByTestId('browser-console')
  /** Runs `code` in the page loaded from `origin` (in main, which can reach every WebContents). */
  const inPage = (origin: string, code: string) =>
    app.evaluate(
      async ({ webContents }, [o, c]) => {
        const target = webContents.getAllWebContents().find((w) => w.getURL().startsWith(o as string))
        return target ? ((await target.executeJavaScript(c as string)) as unknown) : 'no page'
      },
      [origin, code]
    )
  /** The page views over the window: visible flags and bounds. */
  const views = () =>
    app.evaluate(({ BrowserWindow }) =>
      (BrowserWindow.getAllWindows()[0]?.contentView.children ?? []).map((v) => ({ visible: v.getVisible(), bounds: v.getBounds() }))
    )
  const setTheme = async (theme: 'dark' | 'light') => {
    await page.evaluate(
      (t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }),
      theme
    )
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
  }
  const shoot = async (name: string) => {
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(theme)
      await page.waitForTimeout(200)
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) })
    }
    await setTheme('dark')
  }

  test.beforeAll(async () => {
    port = await listen(server)
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: project }],
        worktrees: [{ id: 'w1', projectId: 'p1', branch: 'main', path: project, isMain: true }],
        sessions: [{ id: SESSION, worktreeId: 'w1', kind: 'shell', title: '修复移动端导航抖动', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: SESSION,
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
    app = await launchApp({}, { userDataDir: profile })
    page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    server.close()
  })

  test('opens on the empty state (13E) and opens nothing by itself', async () => {
    await page.locator('header').getByRole('group', { name: '右侧栏' }).getByRole('button', { name: '浏览器' }).click()
    await expect(panel().getByTestId('browser-empty')).toContainText('这个会话还没有打开网页')
    await expect(address()).toHaveAttribute('placeholder', '输入地址或端口号，如 5173')
    await expect(panel().getByRole('button', { name: '后退' })).toBeDisabled()
    expect(await views()).toEqual([])
    await shoot('13E-empty')
  })

  test('a bare port opens localhost; the page loads and cannot reach the app', async () => {
    await address().click()
    await address().fill(String(port))
    await address().press('Enter')
    const origin = `http://localhost:${port}`
    await expect.poll(() => inPage(origin, 'document.title'), { timeout: 15_000 }).toBe('e2e page')
    expect(await inPage(origin, 'typeof window.tr + "|" + typeof require + "|" + typeof process')).toBe('undefined|undefined|undefined')
    // The address shows host and path apart.
    await expect(address().locator('xpath=..')).toContainText(`localhost:${port}`)
    await expect(address()).toHaveValue(`${origin}/`)
  })

  test('counts console errors and warnings, live', async () => {
    await expect(consoleRow()).toContainText('1 个错误')
    await expect(consoleRow()).toContainText('· 1 个警告')
    await inPage(`http://localhost:${port}`, "console.error('late boom'); 1")
    await expect(consoleRow()).toContainText('2 个错误')
    // A plain shell session has no agent to send the errors to.
    await expect(consoleRow().getByRole('button')).toHaveCount(0)
    await shoot('13A-page')
  })

  test('the page covers the well exactly and hides under a modal dialog', async () => {
    const slot = (await panel().getByTestId('browser-page').boundingBox())!
    await expect
      .poll(async () => (await views()).map((v) => v.visible))
      .toEqual([true])
    const [view] = await views()
    expect(Math.abs(view!.bounds.x - slot.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(view!.bounds.width - slot.width)).toBeLessThanOrEqual(1)

    await page.keyboard.press('Meta+KeyK')
    await expect(page.getByTestId('command-palette')).toBeVisible()
    await expect.poll(async () => (await views()).map((v) => v.visible)).toEqual([false])
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await views()).map((v) => v.visible)).toEqual([true])

    // Closing the pane takes the page away; reopening brings the same page back.
    await page.keyboard.press('Meta+Alt+KeyB')
    await expect.poll(async () => (await views()).map((v) => v.visible)).toEqual([false])
    await page.keyboard.press('Meta+Alt+KeyB')
    await expect.poll(async () => (await views()).map((v) => v.visible)).toEqual([true])
  })

  test('the phone icon switches to a 375-wide viewport and back', async () => {
    const toggle = panel().getByRole('button', { name: '手机视口 375' })
    await toggle.click()
    await expect.poll(() => inPage(`http://localhost:${port}`, 'innerWidth')).toBe(375)
    await expect.poll(async () => (await views())[0]?.bounds.width).toBe(375)
    await shoot('13A-mobile')
    await panel().getByRole('button', { name: '退出手机视口' }).click()
    await expect.poll(async () => (await views())[0]?.bounds.width).toBeGreaterThan(375)
  })

  test("lists a port the session's own process listens on, and opens it on click", async () => {
    const own = await freePort()
    const script = `require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<title>from pty</title>')}).listen(${own})`
    await page.locator('[data-region="terminal"] .xterm').first().click()
    await page.keyboard.type(`"${process.execPath}" -e "${script}"`)
    await page.keyboard.press('Enter')
    const tag = panel().getByRole('group', { name: '端口' }).getByRole('button', { name: `:${own}` })
    await expect(tag).toBeVisible({ timeout: 15_000 })
    await tag.click()
    await expect.poll(() => inPage(`http://localhost:${own}`, 'document.title'), { timeout: 15_000 }).toBe('from pty')
    await expect(tag).toHaveAttribute('data-selected', 'true')
    // End the server: its tag goes away on a later scan.
    await page.locator('[data-region="terminal"] .xterm').first().click()
    await page.keyboard.press('Control+C')
    await expect(tag).toHaveCount(0, { timeout: 15_000 })
  })

  test('refuses non-http addresses with a reason', async () => {
    await address().click()
    await address().fill('file:///etc/hosts')
    await address().press('Enter')
    await expect(panel().getByRole('alert')).toContainText('只能打开 http 或 https 地址')
    const urls = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()))
    expect(urls.some((u) => u.startsWith('file:///etc'))).toBe(false)
    await address().press('Escape')
  })
})
