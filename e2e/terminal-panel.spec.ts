// F17 right panel · 终端 (Figma 76A / 76B): plain shells in the active session's worktree, shared by its sessions, one
// tab each. The tab row shows from two shells on; closing a tab ends its shell; another worktree has its own tabs; a
// window reload reattaches the shells; none of them is a workspace session (no sidebar row).
// Screenshots in both themes go to test-results/terminal-panel/ (compare with Figma 76A / 76B).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'terminal-panel')

interface Globals {
  tr: { pty: { write(id: string, data: string): void; live(): Promise<{ sessionId: string; exited: boolean }[]> }; shellName: string }
  __trTerminals?: { readScreen(sessionId: string, scrollbackLines?: number): string }
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('F17 right panel · 终端', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-term-panel-'))
  // Real paths: a shell started in /var/… reports /private/var/….
  const folderA = realpathSync(mkdtempSync(join(tmpdir(), 'tr-e2e-term-a-')))
  const folderB = realpathSync(mkdtempSync(join(tmpdir(), 'tr-e2e-term-b-')))
  // The shells write what the test checks here, so a long path never depends on how the screen wraps it.
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'tr-e2e-term-out-')))
  let app: ElectronApplication
  let page: Page

  const panel = () => page.locator('[data-region="panel"]')
  const body = () => panel().getByTestId('panel-terminal')
  const host = (id: string) => body().locator(`[data-terminal-id="${id}"]`)
  const tabs = () => panel().getByRole('tablist', { name: '终端' }).getByRole('tab')
  const sidebarRows = () => page.locator('[data-region="sidebar"] [data-session-id]')
  const write = (id: string, data: string) => page.evaluate(([i, d]) => (globalThis as unknown as Globals).tr.pty.write(i!, d!), [id, data])
  const screen = (id: string) => page.evaluate((i) => (globalThis as unknown as Globals).__trTerminals?.readScreen(i, 50) ?? '', id)
  const fileText = (name: string) => () => {
    try {
      return readFileSync(join(out, name), 'utf8')
    } catch {
      return ''
    }
  }
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  /** Runs `command` once the shell is up (it answers a marker), so nothing typed is lost to its startup. */
  const run = async (id: string, command: string) => {
    const marker = `ready-${id}-${Date.now()}`
    await expect
      .poll(async () => {
        await write(id, `echo ${marker.slice(0, 6)}''${marker.slice(6)}\r`)
        return (await screen(id)).includes(marker)
      }, { timeout: 30_000, intervals: [1_000] })
      .toBe(true)
    await write(id, `${command}\r`)
  }
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
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) })
    }
    await setTheme('dark')
  }
  const showSession = async (id: string) => {
    await page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`).click()
    await expect(page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`)).toHaveAttribute('aria-current', /.+/)
  }

  test.beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true })
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [
          { id: 'p1', name: 'acme-web', rootPath: folderA },
          { id: 'p2', name: 'tools', rootPath: folderB }
        ],
        worktrees: [
          { id: 'w1', projectId: 'p1', branch: 'session-cookie', path: folderA, isMain: true },
          { id: 'w2', projectId: 'p2', branch: 'main', path: folderB, isMain: true }
        ],
        sessions: [
          { id: 's-a', worktreeId: 'w1', kind: 'shell', title: 'Cookie 会话迁移', startedAt: 1, lastActivityAt: 3 },
          { id: 's-a2', worktreeId: 'w1', kind: 'shell', title: '同一个 worktree', startedAt: 1, lastActivityAt: 2 },
          { id: 's-b', worktreeId: 'w2', kind: 'shell', title: '另一个 worktree', startedAt: 1, lastActivityAt: 1 }
        ],
        activeSessionId: 's-a',
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
    app = await launchApp({}, { userDataDir: profile })
    page = await app.firstWindow()
    await page.addInitScript(() => {
      ;(globalThis as unknown as { __TR_TERMINAL_PROBE__: boolean }).__TR_TERMINAL_PROBE__ = true
    })
    await page.reload()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
    await expect(sidebarRows()).toHaveCount(3)
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test("the header's 终端 icon opens a shell in the session's worktree, with no tab row for one shell", async () => {
    await page.locator('header').getByRole('group', { name: '右侧栏' }).getByRole('button', { name: '终端' }).click()
    await expect(panel().getByRole('heading', { name: '终端' })).toBeVisible()
    await expect(panel()).toContainText('session-cookie')
    await expect(host('panel-w1-1').locator('.xterm')).toBeVisible({ timeout: 20_000 })
    await expect(panel().getByRole('tablist')).toHaveCount(0)
    await run('panel-w1-1', `pwd > '${join(out, 'pwd-a.txt')}'`)
    await expect.poll(fileText('pwd-a.txt'), { timeout: 15_000 }).toBe(`${folderA}\n`)
    // Not a workspace session.
    await expect(sidebarRows()).toHaveCount(3)
  })

  test('+ opens a second shell and the tab row; a tab shows the shell’s title', async () => {
    await panel().getByRole('button', { name: '新建终端' }).click()
    await expect(tabs()).toHaveCount(2)
    // The shell's own title, or its name (zsh) when its setup sets none.
    await expect(tabs().nth(0)).toHaveText(/\S/)
    await expect(tabs().nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(host('panel-w1-2').locator('.xterm')).toBeVisible({ timeout: 20_000 })
    await expect(host('panel-w1-1')).toBeHidden()
    // OSC 0 sets the title; the sleep keeps a prompt hook from setting its own right after.
    await run('panel-w1-2', `echo $$ > '${join(out, 'pid-2.txt')}'; printf '\\033]0;pnpm dev\\007'; sleep 60`)
    await expect(tabs().nth(1)).toHaveText('pnpm dev', { timeout: 15_000 })
    await expect(sidebarRows()).toHaveCount(3)
    await shoot('76a-two-tabs')

    await tabs().nth(0).click()
    await expect(host('panel-w1-1')).toBeVisible()
    await expect(host('panel-w1-2')).toBeHidden()
    await tabs().nth(1).click()
  })

  test('closing a tab ends its shell; the last tab leaves the row', async () => {
    await expect.poll(fileText('pid-2.txt'), { timeout: 15_000 }).toMatch(/^\d+\n$/)
    const pid = Number(fileText('pid-2.txt')().trim())
    expect(alive(pid)).toBe(true)
    await panel().getByRole('tablist').locator('[data-active="true"]').getByRole('button', { name: '关闭终端' }).click()
    await expect(panel().getByRole('tablist')).toHaveCount(0)
    await expect(host('panel-w1-2')).toHaveCount(0)
    await expect(host('panel-w1-1')).toBeVisible()
    await expect.poll(() => alive(pid), { timeout: 15_000 }).toBe(false)
    await shoot('76b-one-tab')
  })

  test("another worktree's session shows that worktree's shells; one in the same worktree shares them", async () => {
    await showSession('s-b')
    await expect(panel()).toContainText('main')
    await expect(host('panel-w2-1').locator('.xterm')).toBeVisible({ timeout: 20_000 })
    await expect(host('panel-w1-1')).toHaveCount(0)
    await run('panel-w2-1', `pwd > '${join(out, 'pwd-b.txt')}'`)
    await expect.poll(fileText('pwd-b.txt'), { timeout: 15_000 }).toBe(`${folderB}\n`)

    await showSession('s-a2')
    await expect(panel()).toContainText('session-cookie')
    await expect(host('panel-w1-1')).toBeVisible()
    await expect(host('panel-w2-1')).toHaveCount(0)
    await expect(panel().getByRole('tablist')).toHaveCount(0)
    await expect(sidebarRows()).toHaveCount(3)
  })

  test('a window reload reattaches the running shells with their output', async () => {
    await run('panel-w1-1', 'echo before-reload')
    await expect.poll(() => screen('panel-w1-1')).toContain('before-reload')
    await page.reload()
    await expect(page.locator('[data-region="terminal"] [data-session-id="s-a2"] .xterm')).toBeVisible({ timeout: 20_000 })
    // The open view is saved with the workspace; open it again if that save had not happened yet.
    await page.waitForTimeout(500)
    if ((await panel().count()) === 0) await page.locator('header').getByRole('group', { name: '右侧栏' }).getByRole('button', { name: '终端' }).click()
    await expect(panel().getByRole('heading', { name: '终端' })).toBeVisible()
    await expect(host('panel-w1-1').locator('.xterm')).toBeVisible({ timeout: 20_000 })
    await expect(panel().getByRole('tablist')).toHaveCount(0)
    await expect.poll(() => screen('panel-w1-1'), { timeout: 15_000 }).toContain('before-reload')
    await expect(sidebarRows()).toHaveCount(3)
  })

  test("a file path printed in a panel shell opens in the 文件 view's preview of its worktree", async () => {
    writeFileSync(join(folderA, 'notes.md'), '# notes\n')
    await run('panel-w1-1', `clear; printf '%s\\n' notes.md:1`)
    await expect.poll(async () => (await screen('panel-w1-1')).split('\n')[0]?.trim()).toBe('notes.md:1')
    const box = (await host('panel-w1-1').locator('.xterm-screen').boundingBox())!
    const size = await page.evaluate(
      () => (globalThis as unknown as { __trTerminals: { size(id: string): { cols: number; rows: number } | null } }).__trTerminals.size('panel-w1-1')
    )
    const at = { x: box.x + (box.width / size!.cols) * 2.5, y: box.y + (box.height / size!.rows) * 0.5 }
    // Hovering names the file (a link of the worktree, checked by main); a click previews it.
    await page.mouse.move(at.x, at.y)
    await expect(host('panel-w1-1').locator('.xterm')).toHaveAttribute('title', /^notes\.md:1\n/)
    await page.mouse.click(at.x, at.y)
    await expect(panel().getByTestId('file-preview')).toBeVisible()
    await expect(panel().getByTitle('notes.md')).toHaveText('notes.md')
    // The session on screen stays the one that was active.
    await expect(page.locator('[data-region="sidebar"] [data-session-id="s-a2"]')).toHaveAttribute('aria-current', 'true')
  })

  // Last: asking the daemon for its list hands this window's terminals back to it (pty.live is a startup call).
  test("the pty daemon's list keeps the open shells and not the closed one", async () => {
    const live = await page.evaluate(() => (globalThis as unknown as Globals).tr.pty.live())
    const ids = live.filter((s) => !s.exited).map((s) => s.sessionId)
    expect(ids).toContain('panel-w1-1')
    expect(ids).toContain('panel-w2-1')
    expect(ids).not.toContain('panel-w1-2')
  })
})
