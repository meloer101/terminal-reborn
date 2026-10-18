// F17 right panel · 浏览器: the empty state, typing a port to open a local server, isolation of the page from the
// app (no window.tr, no Node), console error counting, errors going into the input line (never submitted), the
// keyboard leaving a hidden page, app / page chords, pop-ups gated on real input, the page following the well and
// hiding under dialogs, the mobile viewport, a port found in the session's PTY tree (F14, minimal), refusing
// non-http schemes, and links in the terminal opening here first (⌘-click / the link menu: the system browser).
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

interface Hook {
  readScreen(sessionId: string, scrollbackLines?: number): string
}

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
  const screen = () =>
    page.evaluate((id) => (globalThis as unknown as { __trTerminals?: Hook }).__trTerminals?.readScreen(id, 50) ?? '', SESSION)
  const origin = () => `http://localhost:${port}`
  /** Sends a key straight to the page (as if it had the keyboard) — main's before-input-event sees it first. */
  const keyInPage = (keyCode: string, modifiers: string[]) =>
    app.evaluate(
      ({ webContents }, [o, k, m]) => {
        const target = webContents.getAllWebContents().find((w) => w.getURL().startsWith(o as string))
        target?.sendInputEvent({ type: 'keyDown', keyCode: k as string, modifiers: m as Array<'meta'> })
        target?.sendInputEvent({ type: 'keyUp', keyCode: k as string, modifiers: m as Array<'meta'> })
      },
      [origin(), keyCode, modifiers] as const
    )
  /** Which of the app window and the page has the keyboard. */
  const focus = () =>
    app.evaluate(({ BrowserWindow, webContents }, o) => {
      const page = webContents.getAllWebContents().find((w) => w.getURL().startsWith(o))
      return { app: BrowserWindow.getAllWindows()[0]?.webContents.isFocused() ?? false, page: page?.isFocused() ?? false }
    }, origin())
  /** Puts the keyboard in the page (once it is visible again: a hidden view does not take focus). */
  const givePageFocus = () =>
    expect
      .poll(async () => {
        await app.evaluate(({ webContents }, o) => webContents.getAllWebContents().find((w) => w.getURL().startsWith(o))?.focus(), origin())
        return (await focus()).page
      })
      .toBe(true)
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
    // site.example is a public-looking host (the shared web jar) served by the local test server.
    app = await launchApp({}, { userDataDir: profile, args: ['--host-resolver-rules=MAP site.example 127.0.0.1'] })
    page = await app.firstWindow()
    await page.addInitScript(() => {
      ;(globalThis as unknown as { __TR_TERMINAL_PROBE__: boolean }).__TR_TERMINAL_PROBE__ = true
    })
    await page.reload()
    // Main's shell.openExternal, recorded instead of opening the user's browser.
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as unknown as { __opened: string[] }).__opened = opened
      shell.openExternal = async (url: string) => {
        opened.push(url)
      }
    })
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
    await shoot('13A-page')
  })

  test('errors go into the input line quoted, stripped of controls, and are never submitted', async () => {
    await inPage(origin(), "console.error('evil\\u001b[2J\\u009b31m; echo PWNED'); 1")
    await expect(consoleRow()).toContainText('3 个错误')
    await consoleRow().getByRole('button', { name: '发到终端' }).click()
    await expect(consoleRow().getByRole('button', { name: '已放进输入行' })).toBeVisible()
    await expect.poll(screen).toContain('以下是页面输出的原文引用')
    const text = await screen()
    expect(text).toContain('> evil [2J 31m; echo PWNED')
    // Nothing ran: the shell is still holding the text in its input line.
    await page.waitForTimeout(500)
    expect(await screen()).not.toMatch(/^PWNED$/m)
    expect(await screen()).not.toContain('command not found')
    await page.locator('[data-region="terminal"] .xterm').first().click()
    await page.keyboard.press('Control+C')
  })

  test('a hidden page gives the keyboard back; app chords reach the app from the page', async () => {
    await givePageFocus()
    // ⌘K pressed in the page opens the palette, and typing goes to the palette, not the hidden page.
    await keyInPage('K', ['meta'])
    await expect(page.getByTestId('command-palette')).toBeVisible()
    await expect.poll(focus).toEqual({ app: true, page: false })
    await page.keyboard.type('abc')
    await expect(page.getByTestId('command-palette').locator('input')).toHaveValue('abc')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('command-palette')).toHaveCount(0)

    // ⌘L in the page puts the keyboard in the address field.
    await givePageFocus()
    await keyInPage('L', ['meta'])
    await expect(address()).toBeFocused()
    await expect.poll(focus).toEqual({ app: true, page: false })
    await address().press('Escape')

    // Closing the pane while the page has the keyboard hands it back too.
    await givePageFocus()
    await page.keyboard.press('Meta+Shift+KeyB')
    await expect(panel()).toHaveCount(0)
    await expect.poll(focus).toEqual({ app: true, page: false })
    await page.keyboard.press('Meta+Shift+KeyB')
    await expect(address()).toBeVisible()
  })

  test('pop-ups: same origin stays in the view, other sites only right after input, never in bursts', async () => {
    const opened = () => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened.slice())
    // No user input (the last test's keys in the page are past the 1 s window): dropped, with a notice.
    await page.waitForTimeout(1200)
    await inPage(origin(), "for (let i = 0; i < 5; i++) window.open('https://example.com/spam' + i); 1")
    await expect(panel().getByRole('alert')).toContainText('拦下了页面自己打开的新窗口')
    expect(await opened()).toEqual([])
    // Same origin: loads here.
    await inPage(origin(), "window.open('/second', '_blank'); 1")
    await expect.poll(() => inPage(origin(), 'location.pathname')).toBe('/second')
    // Right after a click in the page: one opens externally, the burst after it does not.
    await app.evaluate(({ webContents }, o) => {
      const target = webContents.getAllWebContents().find((w) => w.getURL().startsWith(o))
      target?.sendInputEvent({ type: 'mouseDown', x: 10, y: 10, button: 'left', clickCount: 1 })
      target?.sendInputEvent({ type: 'mouseUp', x: 10, y: 10, button: 'left', clickCount: 1 })
    }, origin())
    await inPage(origin(), "window.open('https://example.com/a'); window.open('https://example.com/b'); 1")
    await expect.poll(opened).toEqual(['https://example.com/a'])
    await address().click()
    await address().fill(String(port))
    await address().press('Enter')
    await expect.poll(() => inPage(origin(), 'location.pathname')).toBe('/')
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
    await page.keyboard.press('Meta+Shift+KeyB')
    await expect.poll(async () => (await views()).map((v) => v.visible)).toEqual([false])
    await page.keyboard.press('Meta+Shift+KeyB')
    await expect.poll(async () => (await views()).map((v) => v.visible)).toEqual([true])
  })

  test('right-click in the page opens the app menu; 刷新 reloads the page', async () => {
    await inPage(origin(), 'window.__marker = 1; 1')
    await app.evaluate(({ webContents }, o) => {
      const target = webContents.getAllWebContents().find((w) => w.getURL().startsWith(o))
      target?.sendInputEvent({ type: 'mouseDown', x: 40, y: 40, button: 'right', clickCount: 1 })
      target?.sendInputEvent({ type: 'mouseUp', x: 40, y: 40, button: 'right', clickCount: 1 })
    }, origin())
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem')).toHaveText([/后退/, /刷新/, /复制/, /粘贴/, /检查元素/])
    await menu.getByRole('menuitem', { name: /刷新/ }).click()
    await expect.poll(() => inPage(origin(), 'typeof window.__marker')).toBe('undefined')
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

  test('a link in the terminal opens in the built-in browser; ⌘-click and the link menu reach the system browser', async () => {
    // Close the pane, then print a link alone on the first row of a cleared screen.
    await page.locator('header').getByRole('group', { name: '右侧栏' }).getByRole('button', { name: '浏览器' }).click()
    await expect(panel()).toHaveCount(0)
    const link = `${origin()}/linked`
    await page.locator('[data-region="terminal"] .xterm').first().click()
    await page.keyboard.type(`clear; printf '%s\\n' ${link}`)
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await screen()).split('\n')[0]?.trim()).toBe(link)
    /** The middle of the link's character in column `col`, in page coordinates. */
    const linkPoint = async (col: number) => {
      const box = await page.locator('[data-region="terminal"] .xterm-screen').first().boundingBox()
      const size = await page.evaluate(
        (id) => (globalThis as unknown as { __trTerminals: { size(id: string): { cols: number; rows: number } | null } }).__trTerminals.size(id),
        SESSION
      )
      if (!box || !size) throw new Error('no terminal')
      return { x: box.x + (box.width / size.cols) * (col + 0.5), y: box.y + (box.height / size.rows) * 0.5 }
    }
    const at = await linkPoint(4)
    await page.mouse.move(at.x, at.y)
    // The hover hint names the real address.
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toHaveAttribute('title', new RegExp(`^${link}`))
    await page.mouse.click(at.x, at.y)
    await expect(panel().getByRole('textbox', { name: '地址' })).toHaveValue(link)
    await expect.poll(() => inPage(link, 'location.pathname'), { timeout: 15_000 }).toBe('/linked')

    const opened = () => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened.slice())
    // Opening the pane re-fits the terminal; xterm finds the link again once the pointer reaches another cell.
    const meta = await linkPoint(7)
    await page.mouse.move(meta.x, meta.y)
    await page.keyboard.down('Meta')
    await page.mouse.click(meta.x, meta.y)
    await page.keyboard.up('Meta')
    await expect.poll(opened).toContain(link)

    const before = (await opened()).length
    const right = await linkPoint(10)
    await page.mouse.move(right.x, right.y)
    await page.mouse.click(right.x, right.y, { button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: '在内置浏览器打开' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '复制链接' })).toBeVisible()
    await menu.getByRole('menuitem', { name: '用系统浏览器打开' }).click()
    await expect.poll(async () => (await opened()).length).toBe(before + 1)
  })

  test('other sites share one cookie jar and a plain UA; crossing to this machine swaps back to the worktree jar', async () => {
    const web = `http://site.example:${port}`
    await address().click()
    await address().fill(`${web}/signin`)
    await address().press('Enter')
    await expect.poll(() => inPage(web, 'location.pathname'), { timeout: 15_000 }).toBe('/signin')
    /** The partition each loaded page runs in, by origin. */
    const jarOf = (o: string) =>
      app.evaluate(({ session, webContents }, origin) => {
        const target = webContents.getAllWebContents().find((w) => w.getURL().startsWith(origin))
        if (!target) return 'no page'
        return target.session === session.fromPartition('persist:tr-browser:web') ? 'web' : 'other'
      }, o)
    expect(await jarOf(web)).toBe('web')
    expect(await inPage(web, 'navigator.userAgent')).not.toMatch(/Electron|Wavi/)
    // A cookie set here is in the shared jar, where any worktree's page finds it.
    await inPage(web, "document.cookie = 'signed=yes; max-age=600'; 1")
    expect(
      await app.evaluate(async ({ session }) => (await session.fromPartition('persist:tr-browser:web').cookies.get({ name: 'signed' })).length)
    ).toBe(1)
    // The page itself going to localhost: the view swaps to the worktree's own jar.
    await inPage(web, `location.href = '${origin()}/back-home'; 1`)
    await expect.poll(() => inPage(origin(), 'location.pathname'), { timeout: 15_000 }).toBe('/back-home')
    expect(await jarOf(origin())).toBe('other')
    await expect(address()).toHaveValue(`${origin()}/back-home`)
  })

  test('a sign-in pop-up opens as an in-app window that keeps window.opener; ⌘W closes only the pop-up', async () => {
    const web = `http://site.example:${port}`
    await address().click()
    await address().fill(`${web}/login`)
    await address().press('Enter')
    await expect.poll(() => inPage(web, 'location.pathname'), { timeout: 15_000 }).toBe('/login')
    await inPage(web, "window.__got = null; window.addEventListener('message', (e) => { window.__got = e.data }); 1")
    const windows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    expect(await windows()).toBe(1)
    await app.evaluate(({ webContents }, o) => {
      const target = webContents.getAllWebContents().find((w) => w.getURL().startsWith(o))
      target?.sendInputEvent({ type: 'mouseDown', x: 10, y: 10, button: 'left', clickCount: 1 })
      target?.sendInputEvent({ type: 'mouseUp', x: 10, y: 10, button: 'left', clickCount: 1 })
    }, web)
    await inPage(web, `window.open('${web}/oauth', 'signin', 'width=420,height=520'); 1`)
    await expect.poll(windows).toBe(2)
    const popup = () =>
      app.evaluate(async ({ BrowserWindow, session }) => {
        const child = BrowserWindow.getAllWindows().find((w) => w.getParentWindow() !== null)
        if (!child) return null
        const contents = child.webContents
        return {
          url: contents.getURL(),
          webJar: contents.session === session.fromPartition('persist:tr-browser:web'),
          opener: (await contents.executeJavaScript('window.opener !== null')) as boolean
        }
      })
    await expect.poll(async () => (await popup())?.url).toBe(`${web}/oauth`)
    expect(await popup()).toMatchObject({ webJar: true, opener: true })
    // The pop-up reports back to its opener, like a sign-in flow does.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getParentWindow() !== null)
        ?.webContents.executeJavaScript("window.opener.postMessage('signed-in', '*'); 1")
    )
    await expect.poll(() => inPage(web, 'window.__got')).toBe('signed-in')
    // ⌘W (the 关闭会话 menu item) in the pop-up closes the pop-up and leaves the session alone.
    await app.evaluate(({ BrowserWindow, Menu }) => {
      const child = BrowserWindow.getAllWindows().find((w) => w.getParentWindow() !== null)
      const item = Menu.getApplicationMenu()
        ?.items.flatMap((i) => i.submenu?.items ?? [])
        .find((i) => i.label === '关闭会话')
      item?.click(undefined, child, undefined)
    })
    await expect.poll(windows).toBe(1)
    await expect(page.locator('[data-region="sidebar"]')).toContainText('修复移动端导航抖动')
  })
})
