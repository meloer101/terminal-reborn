// Several windows (PRD F20 · 多窗口) over the fixture workspace: a project opened in a window of its own (its sidebar
// lists only that project), a pane dragged out of the window into a new one (its terminal keeps its scrollback and
// typing reaches the PTY once), and closing a secondary window (its sessions keep running and stay in the main
// window's sidebar). Screenshots of a secondary window in both themes (test-results/multi-window). Restoring the
// windows after a restart is in multi-window-restore.spec.ts.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'multi-window')

interface Hook {
  readScreen(sessionId: string, scrollbackLines?: number): string
}
interface WindowRecord {
  key: string
  projectId: string | null
  sidebarCollapsed: boolean
}
interface WorkspaceHook {
  getState(): {
    activeSessionId: string | null
    split: unknown
    keyWindow: string
    windows: WindowRecord[]
    windowViews: Record<string, { split: unknown; activeSessionId: string | null }>
    dropSession(id: string, target: string, zone: string): void
    setActiveSession(id: string): void
  }
}

let app: ElectronApplication
let page: Page

const workspace = () => page.evaluate(() => (globalThis as unknown as { __trWorkspace: WorkspaceHook }).__trWorkspace.getState())
/** Terminals all live in the main window's renderer, whichever window shows them. */
const screen = (id: string, scrollback = 200) =>
  page.evaluate(([sid, n]) => (globalThis as unknown as { __trTerminals: Hook }).__trTerminals.readScreen(sid as string, n as number), [id, scrollback] as const)
const terminalIn = (p: Page, id: string) => p.locator(`[data-region="terminal"] [data-session-id="${id}"]`)
const headerIn = (p: Page, id: string) => p.locator(`[data-region="split"] [data-pane-id="${id}"]`)
const rowIn = (p: Page, id: string) => p.locator(`[data-region="sidebar"] [data-session-id="${id}"]`)
const count = (text: string, word: string): number => text.split(word).length - 1

/** The app windows main knows about, with their titles. */
const nativeWindows = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && w.getParentWindow() === null)
      .map((w) => ({ id: w.id, title: w.getTitle(), url: w.webContents.getURL(), bounds: w.getBounds() }))
  )

/** The red button of every secondary window (they have no page of their own: their URL stays about:blank). */
const closeSecondaryWindows = () =>
  app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL() === 'about:blank') w.close()
  })

async function run(p: Page, id: string, command: string): Promise<void> {
  await terminalIn(p, id).click()
  await p.keyboard.type(command)
  await p.keyboard.press('Enter')
}

const setTheme = (theme: 'dark' | 'light') =>
  page.evaluate((t) => {
    ;(globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.theme = t
  }, theme)

async function shoot(p: Page, name: string): Promise<void> {
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(theme)
    // The secondary window follows the main window's <html> attributes.
    await expect(p.locator('html')).toHaveAttribute('data-theme', theme)
    await p.waitForTimeout(150)
    await p.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) })
  }
  await setTheme('dark')
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true })
  app = await launchApp()
  page = await app.firstWindow()
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __TR_E2E__: boolean }).__TR_E2E__ = true
  })
  await page.reload()
  await setWindowSize(app, page, 1440, 900)
  await expect(terminalIn(page, 's-cookie')).toBeVisible()
  await expect.poll(() => screen('s-cookie'), { timeout: 20_000 }).not.toBe('')
})

test.afterAll(async () => {
  await app?.close()
})

test('a project opens in a window of its own, whose sidebar lists only that project', async () => {
  const opened = app.waitForEvent('window')
  await page.locator('[data-region="sidebar"]').getByRole('heading', { name: 'terminal-reborn' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '在新窗口中打开' }).click()
  const child = await opened
  await expect(child.locator('[data-region="sidebar"]')).toBeVisible()
  // Only the project's sessions, the first of them shown.
  await expect(rowIn(child, 's-sidebar')).toBeVisible()
  await expect(rowIn(child, 's-graph')).toBeVisible()
  await expect(rowIn(child, 's-cookie')).toHaveCount(0)
  await expect(terminalIn(child, 's-sidebar').locator('.xterm')).toBeVisible({ timeout: 20_000 })
  await expect.poll(async () => (await nativeWindows()).map((w) => w.title)).toContain('terminal-reborn')
  // The keyboard is there, and typing reaches that session's PTY.
  await run(child, 's-sidebar', 'echo from-the-window')
  await expect.poll(() => screen('s-sidebar')).toContain('from-the-window')
  const state = await workspace()
  expect(state.windows).toHaveLength(1)
  expect(state.windows[0]?.projectId).toBe('p-tr')
  // The main window still lists every project, its own pane untouched.
  await expect(rowIn(page, 's-cookie')).toBeVisible()
  await expect(terminalIn(page, 's-cookie')).toBeVisible()
  await shoot(child, 'project-window')
  // Asking again brings the same window forward instead of a second one.
  await page.bringToFront()
  await page.locator('[data-region="sidebar"]').getByRole('heading', { name: 'terminal-reborn' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '在新窗口中打开' }).click()
  await expect.poll(async () => (await workspace()).windows.length).toBe(1)
  await closeSecondaryWindows()
  await expect.poll(async () => (await workspace()).windows.length).toBe(0)
})

test('a pane dragged out of the window becomes its own window, terminal and scrollback intact', async () => {
  await page.bringToFront()
  await page.evaluate(() => (globalThis as unknown as { __trWorkspace: WorkspaceHook }).__trWorkspace.getState().dropSession('s-perf', 's-cookie', 'right'))
  await expect(terminalIn(page, 's-perf')).toBeVisible()
  await expect.poll(() => screen('s-perf'), { timeout: 20_000 }).not.toBe('')
  await run(page, 's-perf', 'echo before-the-move')
  await expect.poll(() => screen('s-perf')).toContain('before-the-move')

  const title = await headerIn(page, 's-perf').locator('h1').boundingBox()
  if (!title) throw new Error('no title')
  const width = await page.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)
  const opened = app.waitForEvent('window')
  await page.mouse.move(title.x + 10, title.y + title.height / 2)
  await page.mouse.down()
  await page.mouse.move(width - 40, title.y + 120, { steps: 6 })
  // Past the window's edge: releasing opens a new window.
  await page.mouse.move(width + 120, title.y + 160, { steps: 6 })
  await expect(page.getByText('松开在新窗口中打开')).toBeVisible()
  await page.mouse.up()
  const child = await opened

  await expect(terminalIn(child, 's-perf').locator('.xterm')).toBeVisible({ timeout: 20_000 })
  // Gone from the main window, which is back to one pane.
  await expect(headerIn(page, 's-perf')).toHaveCount(0)
  await expect(terminalIn(page, 's-cookie')).toBeVisible()
  const state = await workspace()
  expect(state.windows).toHaveLength(1)
  expect(state.windows[0]?.sidebarCollapsed).toBe(true)
  expect(state.windowViews.main?.activeSessionId ?? state.activeSessionId).toBe('s-cookie')
  // The same terminal: what it printed before the move is still there.
  expect(await screen('s-perf')).toContain('before-the-move')
  // Typing in the new window reaches the PTY once (the command line and its output, nothing doubled).
  await run(child, 's-perf', 'echo after-the-move')
  await expect.poll(async () => count(await screen('s-perf'), 'after-the-move')).toBe(2)
  // Both windows' sidebars mark it as shown; in the new window it is the selected row once the sidebar is back.
  await expect(rowIn(page, 's-perf')).toHaveAttribute('data-shown', 'true')
  await shoot(child, 'pane-window')
  await closeSecondaryWindows()
})

test('closing a secondary window keeps its sessions running in the main window', async () => {
  await expect.poll(async () => (await workspace()).windows.length).toBe(0)
  // s-perf shows nowhere now, but it was never stopped: its terminal comes back with everything it printed.
  await expect(rowIn(page, 's-perf')).toBeVisible()
  await rowIn(page, 's-perf').click()
  await expect(terminalIn(page, 's-perf')).toBeVisible()
  const text = await screen('s-perf')
  expect(text).toContain('before-the-move')
  expect(count(text, 'after-the-move')).toBe(2)
  await run(page, 's-perf', 'echo back-home')
  await expect.poll(() => screen('s-perf')).toContain('back-home')
  expect((await nativeWindows()).length).toBe(1)
})

test('显示 › 把这一格移到新窗口 and ⌘W in the new window act on its own session', async () => {
  await page.bringToFront()
  await page.evaluate(() => (globalThis as unknown as { __trWorkspace: WorkspaceHook }).__trWorkspace.getState().dropSession('s-nav', 's-perf', 'right'))
  await expect(terminalIn(page, 's-nav')).toBeVisible()
  await terminalIn(page, 's-nav').click()
  const opened = app.waitForEvent('window')
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()?.items.flatMap((m) => m.submenu?.items ?? []).find((i) => i.label === '把这一格移到新窗口')
    item?.click(undefined, BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() !== 'about:blank'), undefined)
  })
  const child = await opened
  await expect(terminalIn(child, 's-nav').locator('.xterm')).toBeVisible({ timeout: 20_000 })
  await expect(headerIn(page, 's-nav')).toHaveCount(0)
  expect((await workspace()).keyWindow).not.toBe('main')
  // ⌘W there closes that window's session, not the main window's.
  await terminalIn(child, 's-nav').click()
  await child.keyboard.press('Meta+w')
  await expect(rowIn(page, 's-nav')).toHaveCount(0)
  await expect(terminalIn(page, 's-perf')).toBeVisible()
  // The project window shows another of its project's sessions no window shows (never one shown twice).
  const state = await workspace()
  const shown = [state.activeSessionId, ...Object.values(state.windowViews).map((v) => v.activeSessionId)].filter(Boolean)
  expect(new Set(shown).size).toBe(shown.length)
  await closeSecondaryWindows()
})
