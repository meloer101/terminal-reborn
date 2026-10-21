// Several windows survive a restart (PRD F20 · 多窗口): each secondary window's project, panes and place on screen are
// saved in workspace.json and reopened on the next launch, beside the main window's own panes. Seeded on disk like
// split-restore.spec.ts; plain shells with an empty zsh profile.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, setWindowSize } from './launch'

interface SavedWindow {
  key: string
  projectId?: string
  activeSessionId?: string
  bounds?: { x: number; y: number; width: number; height: number }
}
interface Saved {
  activeSessionId: string | null
  windows?: SavedWindow[]
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

test.describe('window persistence', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-windows-'))
  const projectA = mkdtempSync(join(tmpdir(), 'tr-e2e-windows-a-'))
  const projectB = mkdtempSync(join(tmpdir(), 'tr-e2e-windows-b-'))
  const zdot = mkdtempSync(join(tmpdir(), 'tr-e2e-windows-zdot-'))
  const workspaceFile = join(profile, 'workspace.json')
  const env = { ZDOTDIR: zdot, SHELL: '/bin/zsh' }
  let app: ElectronApplication
  let page: Page

  const saved = (): Saved => JSON.parse(readFileSync(workspaceFile, 'utf8')) as Saved
  const terminalIn = (p: Page, id: string) => p.locator(`[data-region="terminal"] [data-session-id="${id}"] .xterm`)
  /** Secondary windows have no page of their own: their URL stays about:blank. */
  const secondaryPages = () => app.windows().filter((p) => p.url() === 'about:blank')
  const pageShowing = async (id: string): Promise<Page> => {
    await expect.poll(async () => {
      for (const p of secondaryPages()) if ((await terminalIn(p, id).count()) > 0) return true
      return false
    }, { timeout: 20_000 }).toBe(true)
    for (const p of secondaryPages()) if ((await terminalIn(p, id).count()) > 0) return p
    throw new Error(`no window shows ${id}`)
  }
  const nativeSecondary = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => w.webContents.getURL() === 'about:blank')
        .map((w) => ({ title: w.getTitle(), bounds: w.getNormalBounds() }))
    )

  const launch = async () => {
    app = await launchApp(env, { userDataDir: profile })
    await app.firstWindow()
    // The main window's page (a restored secondary window may come up first).
    await expect.poll(() => app.windows().some((p) => /^(file|https?):/.test(p.url()))).toBe(true)
    page = app.windows().find((p) => /^(file|https?):/.test(p.url()))!
    await setWindowSize(app, page, 1280, 820)
    await expect(page.locator('[data-region="sidebar"]')).toBeVisible()
  }

  test.beforeAll(() => {
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(zdot, '.zshrc'), 'PS1="$ "\n')
    const session = (id: string, worktreeId: string, title: string) => ({ id, worktreeId, kind: 'shell', title, startedAt: 1, lastActivityAt: 1 })
    writeFileSync(
      workspaceFile,
      JSON.stringify({
        version: 2,
        projects: [
          { id: 'p1', name: 'alpha', rootPath: projectA },
          { id: 'p2', name: 'beta', rootPath: projectB }
        ],
        worktrees: [
          { id: 'w1', projectId: 'p1', branch: '', path: projectA, isMain: true },
          { id: 'w2', projectId: 'p2', branch: '', path: projectB, isMain: true }
        ],
        sessions: [session('s-a', 'w1', 'Alpha one'), session('s-b', 'w1', 'Alpha two'), session('s-c', 'w2', 'Beta one')],
        activeSessionId: 's-a',
        sidebarCollapsed: false,
        rightPanel: null,
        collapsedProjectIds: [],
        drafts: {},
        windows: [{ key: 'w-seeded', projectId: 'p2', activeSessionId: 's-c', bounds: { x: 140, y: 120, width: 900, height: 620 } }]
      })
    )
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('a saved secondary window opens again with its project, session and place', async () => {
    await launch()
    await expect(terminalIn(page, 's-a')).toBeVisible({ timeout: 20_000 })
    const beta = await pageShowing('s-c')
    await expect(beta.locator('[data-region="sidebar"]').getByRole('heading', { name: 'beta' })).toBeVisible()
    await expect(beta.locator('[data-region="sidebar"]').getByRole('heading', { name: 'alpha' })).toHaveCount(0)
    const [native] = await nativeSecondary()
    expect(native?.title).toBe('beta')
    expect(native?.bounds).toMatchObject({ width: 900, height: 620 })
    // Shown in a window, so it was started.
    await expect(terminalIn(beta, 's-c')).toBeVisible({ timeout: 20_000 })
  })

  test('windows opened, moved and closed are saved and come back after a restart', async () => {
    // Alpha two goes to a window of its own (its row's menu), which is then moved.
    await page.locator('[data-region="sidebar"] [data-session-id="s-b"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: '移到新窗口' }).click()
    const two = await pageShowing('s-b')
    await expect(terminalIn(two, 's-b')).toBeVisible({ timeout: 20_000 })
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === 'about:blank' && w.getTitle() === 'alpha')
      win?.setBounds({ x: 200, y: 160, width: 960, height: 640 })
    })
    await expect
      .poll(() => saved().windows?.find((w) => w.activeSessionId === 's-b')?.bounds, { timeout: 10_000 })
      .toMatchObject({ width: 960, height: 640 })
    expect(saved().windows?.map((w) => w.activeSessionId).sort()).toEqual(['s-b', 's-c'])
    // The red button of beta's window: it is no longer saved; its session keeps running in the main window's list.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() === 'about:blank' && w.getTitle() === 'beta')
        ?.close()
    })
    await expect.poll(() => saved().windows?.map((w) => w.activeSessionId), { timeout: 10_000 }).toEqual(['s-b'])
    await expect(page.locator('[data-region="sidebar"] [data-session-id="s-c"]')).toBeVisible()
    // The right-click selected Alpha two in the main window first, so moving it out left the main window empty.
    expect(saved().activeSessionId).toBeNull()
    await app.close()

    await launch()
    const back = await pageShowing('s-b')
    await expect(terminalIn(back, 's-b')).toBeVisible()
    const windows = await nativeSecondary()
    expect(windows.map((w) => w.title)).toEqual(['alpha'])
    expect(windows[0]?.bounds).toMatchObject({ width: 960, height: 640 })
    // The main window stays as it was left: empty, not showing a session another window shows.
    await expect(page.locator('[data-region="terminal"] [data-session-id="s-b"]')).toBeHidden()
    await expect(page.locator('[data-region="split"] [data-pane-id]')).toHaveCount(0)
    expect(saved().activeSessionId).toBeNull()
    await page.screenshot({ path: 'test-results/multi-window/restored-main.png' })
    await back.screenshot({ path: 'test-results/multi-window/restored-window.png' })
  })
})
