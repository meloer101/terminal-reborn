// F4 脚本与端口 on a real repository whose `.tr/settings.toml` has setup and run scripts: a new worktree runs setup in
// its visible terminal after the confirmation (auto-answered through TR_E2E_DIALOGS), every terminal of a worktree
// has its TR_PORT, the header's Run button starts / shows / stops `run` in its own terminal, a failing setup is said
// under the session and the shell still starts, and a declined confirmation runs nothing. Screenshots in both themes
// go to test-results/repo-scripts/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'repo-scripts')

const SETTINGS = `# Wavi scripts
[scripts]
setup = ["echo \\"SETUP_RAN port=$TR_PORT\\" > setup-ran.txt", "echo SETUP_OK"]
run = "echo RUN_PORT=$TR_PORT; sleep 120"
archive = "echo bye"
`

function makeRepo(): { base: string; home: string; demo: string; git(...args: string[]): string } {
  const base = mkdtempSync(join(tmpdir(), 'tr-e2e-repo-scripts-'))
  const home = join(base, 'home')
  const demo = join(base, 'demo')
  for (const dir of [home, join(demo, '.tr')]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(home, '.zshrc'), '')
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd: demo }).toString()
  writeFileSync(join(demo, 'README.md'), '# demo\n')
  writeFileSync(join(demo, '.gitignore'), 'setup-ran.txt\n')
  writeFileSync(join(demo, '.tr', 'settings.toml'), SETTINGS)
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Jacob E2E')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return { base, home, demo, git }
}

interface Dialog {
  message: string
  detail?: string
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('F4 脚本与端口', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-repo-scripts-profile-'))
  const fx = makeRepo()
  let app: ElectronApplication
  let page: Page
  let firstPort = ''

  const sheet = () => page.getByTestId('new-session-sheet')
  const sidebar = () => page.locator('[data-region="sidebar"]')
  const runButton = () => page.getByTestId('run-script')
  const strip = () => page.getByTestId('setup-strip')
  const dialogs = () => app.evaluate(() => (globalThis as unknown as { __trDialogs: { requests: Dialog[] } }).__trDialogs.requests)
  const answerDialogs = (answer: boolean) =>
    app.evaluate((_electron, value) => {
      ;(globalThis as unknown as { __trDialogs: { answer: boolean } }).__trDialogs.answer = value
    }, answer)
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
      await page.waitForTimeout(250)
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) })
    }
    await setTheme('dark')
  }
  const activeId = () => page.locator('[data-region="terminal"] [data-active="true"]').getAttribute('data-session-id')
  /** The active terminal's screen text plus some scrollback. */
  const activeScreen = async () => {
    const id = await activeId()
    return page.evaluate((sid) => (globalThis as unknown as { __trTerminals: { readScreen(id: string, n: number): string } }).__trTerminals.readScreen(sid ?? '', 200), id)
  }
  const typeInTerminal = async (text: string) => {
    await page.locator('[data-region="terminal"] [data-active="true"]').click()
    await page.keyboard.type(text)
  }
  /** ⌘N → 终端 → 高级 · 分支名 → ⌘↵; resolves to the new worktree's folder. */
  const createWorktree = async (branch: string) => {
    await page.locator('[data-region="terminal"]').click()
    await page.keyboard.press('Meta+n')
    await expect(sheet()).toBeVisible()
    await sheet().getByRole('radio', { name: '终端', exact: true }).click()
    await sheet().getByRole('button', { name: /高级/ }).click()
    await expect(sheet().getByRole('group', { name: '准备' })).toContainText('运行 setup 脚本')
    await sheet().getByRole('textbox', { name: '分支名' }).fill(branch)
    await page.keyboard.press('Meta+Enter')
    await expect(sheet()).toHaveCount(0)
    return join(fx.home, '.tr', 'worktrees', 'demo', branch.split('/').pop()!)
  }

  test.beforeAll(async () => {
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: fx.demo }],
        worktrees: [{ id: 'w-demo', projectId: 'p1', branch: 'main', path: fx.demo, isMain: true }],
        sessions: [{ id: 's-main', worktreeId: 'w-demo', kind: 'shell', title: '主终端', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's-main',
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
    app = await launchApp({ HOME: fx.home }, { userDataDir: profile })
    page = await app.firstWindow()
    await page.addInitScript(() => {
      ;(globalThis as unknown as { __TR_TERMINAL_PROBE__: boolean }).__TR_TERMINAL_PROBE__ = true
    })
    await page.reload()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('a new worktree runs setup in its terminal after the confirmation, then the shell starts', async () => {
    const folder = await createWorktree('jacob/fresh-otter')
    await expect.poll(() => existsSync(join(folder, 'setup-ran.txt')), { timeout: 30_000 }).toBe(true)
    const ran = readFileSync(join(folder, 'setup-ran.txt'), 'utf8')
    expect(ran).toMatch(/^SETUP_RAN port=\d+\n$/)
    firstPort = /port=(\d+)/.exec(ran)![1]!

    // Asked once, listing every command of the file.
    const asked = await dialogs()
    expect(asked).toHaveLength(1)
    expect(asked[0]!.message).toBe('运行仓库 demo 的脚本？')
    expect(asked[0]!.detail).toContain('echo SETUP_OK')
    expect(asked[0]!.detail).toContain('echo RUN_PORT=$TR_PORT; sleep 120')
    expect(asked[0]!.detail).toContain('archive（归档时）')

    await expect.poll(activeScreen, { timeout: 15_000 }).toContain('SETUP_OK')
    await expect(strip()).toHaveCount(0)
    // The shell that follows has the same TR_PORT.
    await typeInTerminal('echo "SHELL_PORT=$TR_PORT"\n')
    await expect.poll(activeScreen, { timeout: 10_000 }).toContain(`SHELL_PORT=${firstPort}`)
  })

  test('the main checkout has a TR_PORT block of its own', async () => {
    await sidebar().locator('[data-session-id="s-main"]').click()
    await typeInTerminal('echo "MAIN_PORT=$TR_PORT"\n')
    await expect.poll(activeScreen, { timeout: 10_000 }).toMatch(/MAIN_PORT=\d+/)
    const mainPort = /MAIN_PORT=(\d+)/.exec(await activeScreen())![1]!
    expect(mainPort).not.toBe(firstPort)
    expect(Math.abs(Number(mainPort) - Number(firstPort)) % 10).toBe(0)
  })

  test('Run starts the run script in its own terminal with TR_PORT, shows it, and stops it', async () => {
    // Back in the new worktree's shell session.
    const worktreeRow = sidebar().locator('section[aria-label="demo"] [data-session-id]').nth(1)
    await worktreeRow.click()
    const shellId = await activeId()
    await expect(runButton()).toHaveAttribute('aria-label', '运行 run 脚本')
    await expect(runButton()).toHaveAttribute('title', `运行 run 脚本 · echo RUN_PORT=$TR_PORT; sleep 120 · TR_PORT ${firstPort}`)
    await shoot('run-idle')

    await runButton().click()
    await expect(sidebar().locator('section[aria-label="demo"] [data-session-id]')).toHaveCount(3)
    await expect(page.locator('[data-region="main"] h1')).toHaveText('run')
    await expect.poll(activeScreen, { timeout: 15_000 }).toContain(`RUN_PORT=${firstPort}`)
    // Already approved: no second sheet.
    expect(await dialogs()).toHaveLength(1)
    await expect(runButton()).toHaveAttribute('aria-label', '停止 run 脚本')
    await shoot('run-running')

    // From the worktree's other session the button shows the running one.
    await sidebar().locator(`[data-session-id="${shellId}"]`).click()
    await expect(runButton()).toHaveAttribute('aria-label', '显示正在运行的 run')
    await runButton().click()
    await expect(page.locator('[data-region="main"] h1')).toHaveText('run')

    // In the run session it stops the script; its terminal says so.
    await runButton().click()
    await expect.poll(activeScreen, { timeout: 10_000 }).toContain('[进程已退出')
    await expect(runButton()).toHaveAttribute('aria-label', '运行 run 脚本')

    // Run again: same session, the earlier output stays above.
    await runButton().click()
    await expect.poll(async () => (await activeScreen()).split(`RUN_PORT=${firstPort}`).length - 1, { timeout: 15_000 }).toBe(2)
    await expect(sidebar().locator('section[aria-label="demo"] [data-session-id]')).toHaveCount(3)
    await runButton().click()
    await expect(runButton()).toHaveAttribute('aria-label', '运行 run 脚本')
  })

  test('a failing setup is said under the session and the shell still starts', async () => {
    writeFileSync(join(fx.demo, '.tr', 'settings.toml'), SETTINGS.replace(/^setup = .*$/m, 'setup = "echo BROKEN; exit 3"'))
    fx.git('commit', '-q', '-am', 'break setup')
    const folder = await createWorktree('jacob/broken-yak')
    // Changed scripts: asked again.
    await expect.poll(async () => (await dialogs()).length, { timeout: 30_000 }).toBe(2)
    expect((await dialogs())[1]!.detail).toContain('echo BROKEN; exit 3')
    await expect(strip()).toHaveText(/setup 脚本失败（退出码 3），输出留在终端里/, { timeout: 30_000 })
    await expect.poll(activeScreen).toContain('setup 脚本失败，退出码 3 · 按回车继续')
    expect(existsSync(folder)).toBe(true)
    // The header read the new folder's scripts once it existed.
    await expect(runButton()).toBeVisible()
    await shoot('setup-failed')

    await strip().getByRole('button', { name: '继续打开终端' }).click()
    await expect(strip()).toHaveCount(0)
    await typeInTerminal('echo "AFTER_PORT=$TR_PORT"\n')
    await expect.poll(activeScreen, { timeout: 10_000 }).toMatch(/AFTER_PORT=\d+/)
    const port = /AFTER_PORT=(\d+)/.exec(await activeScreen())![1]!
    expect(port).not.toBe(firstPort)
  })

  test('declining the confirmation runs nothing', async () => {
    // A changed run script in the main checkout needs a new approval; say no.
    writeFileSync(join(fx.demo, '.tr', 'settings.toml'), SETTINGS.replace('sleep 120', 'sleep 5'))
    await answerDialogs(false)
    await sidebar().locator('[data-session-id="s-main"]').click()
    const before = await sidebar().locator('section[aria-label="demo"] [data-session-id]').count()
    await expect(runButton()).toBeVisible()
    await runButton().click()
    await expect.poll(async () => (await dialogs()).length).toBe(3)
    await page.waitForTimeout(500)
    await expect(sidebar().locator('section[aria-label="demo"] [data-session-id]')).toHaveCount(before)
    await expect(page.locator('[data-region="main"] h1')).toHaveText('主终端')
    await answerDialogs(true)
  })
})
