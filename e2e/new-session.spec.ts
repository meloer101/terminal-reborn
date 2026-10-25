// F4 新建会话 sheet (Figma 15) on a real repository: the defaults (15A), 当前目录 (15B), the 基于 menu with local / remote
// branches and one already in a worktree (15C), 高级 (15D), a branch name that exists (15E), a folder that is not a git
// repository (15F), both themes (15G); then creating a worktree in the background, the remembered 工作目录 and a branch
// that opens its existing worktree. HOME is a temp folder, so worktrees go to <tmp>/.tr/worktrees. Screenshots of every
// state in both themes go to test-results/new-session/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'new-session')

/** demo: main + release/1.4, jacob/checkout-coupon checked out in a linked worktree, origin/feat/coupon-v2; notes: no git. */
function makeProjects(): { base: string; home: string; demo: string; coupon: string; notes: string } {
  const base = mkdtempSync(join(tmpdir(), 'tr-e2e-new-session-'))
  const home = join(base, 'home')
  const demo = join(base, 'demo')
  const origin = join(base, 'origin.git')
  const coupon = join(base, 'wt-coupon')
  const notes = join(base, 'notes')
  for (const dir of [home, demo, notes]) mkdirSync(dir, { recursive: true })
  // Keep zsh quiet in the fake home (no new-user wizard).
  writeFileSync(join(home, '.zshrc'), '')
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd })
  writeFileSync(join(demo, 'README.md'), '# demo\n')
  writeFileSync(join(demo, '.gitignore'), '.env*\n')
  writeFileSync(join(demo, '.worktreeinclude'), '.env.local\n')
  writeFileSync(join(demo, '.env.local'), 'TOKEN=e2e\n')
  git(demo, 'init', '-q', '-b', 'main')
  git(demo, 'config', 'user.name', 'Jacob E2E')
  git(demo, 'add', '.')
  git(demo, 'commit', '-q', '-m', 'init')
  git(demo, 'branch', 'release/1.4')
  git(demo, 'branch', 'feat/coupon-v2')
  git(base, 'init', '-q', '--bare', origin)
  git(demo, 'remote', 'add', 'origin', origin)
  git(demo, 'push', '-q', 'origin', 'main', 'feat/coupon-v2')
  git(demo, 'branch', '-D', 'feat/coupon-v2')
  git(demo, 'fetch', '-q', 'origin')
  git(demo, 'worktree', 'add', '-q', '-b', 'jacob/checkout-coupon', coupon)
  writeFileSync(join(notes, 'todo.md'), '- x\n')
  return { base, home, demo, coupon, notes }
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

test.describe('F4 新建会话', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-new-session-profile-'))
  const fx = makeProjects()
  let app: ElectronApplication
  let page: Page

  const sheet = () => page.getByTestId('new-session-sheet')
  const sidebar = () => page.locator('[data-region="sidebar"]')
  const radio = (name: string) => sheet().getByRole('radio', { name, exact: true })
  /** 智能体 is a pop-up menu (Figma 24A). */
  const pickAgent = async (name: string) => {
    await sheet().getByRole('button', { name: '智能体' }).click()
    await page.getByRole('listbox', { name: '智能体' }).getByRole('option', { name, exact: true }).click()
  }
  const createButton = () => sheet().getByRole('button', { name: /创建/ })
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
  /** The active terminal's screen text (the WebGL renderer leaves no text in the DOM). */
  const activeScreen = async () => {
    const id = await page.locator('[data-region="terminal"] [data-active="true"]').getAttribute('data-session-id')
    return page.evaluate((sid) => (globalThis as unknown as { __trTerminals: { readScreen(id: string, n: number): string } }).__trTerminals.readScreen(sid ?? '', 0), id)
  }
  const openSheet = async () => {
    await page.locator('[data-region="terminal"]').click()
    await page.keyboard.press('Meta+n')
    await expect(sheet()).toBeVisible()
  }

  test.beforeAll(async () => {
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [
          { id: 'p1', name: 'demo', rootPath: fx.demo },
          { id: 'p2', name: 'notes', rootPath: fx.notes }
        ],
        worktrees: [
          { id: 'w-demo', projectId: 'p1', branch: 'main', path: fx.demo, isMain: true },
          { id: 'w-notes', projectId: 'p2', branch: '', path: fx.notes, isMain: true }
        ],
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

  test('15A: ⌘N opens the sheet with every row filled in', async () => {
    await openSheet()
    await expect(sheet().getByRole('heading', { name: '新建会话' })).toBeVisible()
    await expect(sheet().getByRole('button', { name: '项目' })).toHaveText('demo')
    await expect(radio('新 worktree')).toHaveAttribute('aria-checked', 'true')
    await expect(sheet().getByRole('button', { name: '基于' })).toHaveText('main')
    await expect(sheet().getByRole('button', { name: '智能体' })).toContainText('Claude Code')
    const advanced = sheet().getByRole('button', { name: /高级/ })
    await expect(advanced).toHaveAttribute('aria-expanded', 'false')
    await expect(advanced).toHaveText(/^高级jacob\/[a-z]+-[a-z]+$/)
    await expect(createButton()).toBeEnabled()
    await shoot('15a-default')
  })

  test('15B: 当前目录 greys out 基于 and shows the current branch', async () => {
    await radio('当前目录').click()
    const base = sheet().getByRole('button', { name: '基于' })
    await expect(base).toBeDisabled()
    await expect(base).toHaveText('main（当前分支）')
    await expect(sheet().getByRole('button', { name: /高级/ })).toHaveCount(0)
    await shoot('15b-current-folder')
    await radio('新 worktree').click()
  })

  test('15C: 基于 lists local and remote branches and marks the one already in a worktree', async () => {
    await sheet().getByRole('button', { name: '基于' }).click()
    const list = page.getByRole('listbox', { name: '基于' })
    await expect(list).toBeVisible()
    await expect(page.getByRole('textbox', { name: '搜索分支' })).toBeFocused()
    await expect(list.getByRole('option')).toHaveText(['main项目默认', 'jacob/checkout-coupon已在 worktree 里', 'release/1.4', 'origin/feat/coupon-v2'])
    await expect(page.getByText('已在 worktree 里的分支：会改为在那个 worktree 里再开一个会话')).toBeVisible()
    await shoot('15c-branch-menu')
    await page.keyboard.type('coupon')
    await expect(list.getByRole('option')).toHaveText(['jacob/checkout-coupon已在 worktree 里', 'origin/feat/coupon-v2'])
    // Esc closes the menu only.
    await page.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
    await expect(sheet()).toBeVisible()
  })

  test('15D / 15E: 高级 shows branch, folder and 准备; an existing branch name blocks 创建', async () => {
    await sheet().getByRole('button', { name: /高级/ }).click()
    const name = sheet().getByRole('textbox', { name: '分支名' })
    await expect(name).toHaveValue(/^jacob\/[a-z]+-[a-z]+$/)
    await expect(sheet().getByRole('group', { name: '文件夹' })).toContainText('~/.tr/worktrees/demo/')
    await expect(sheet().getByRole('group', { name: '准备' })).toContainText('复制 .env.local')
    await expect(sheet().getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    await shoot('15d-advanced')

    await name.fill('release/1.4')
    await expect(sheet().getByRole('alert')).toHaveText('分支 release/1.4 已经存在。换个名字，或在「基于」里直接选它')
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    await expect(createButton()).toBeDisabled()
    await shoot('15e-branch-exists')
    await name.fill('jacob/fresh-otter')
    await expect(sheet().getByRole('alert')).toHaveCount(0)
    await expect(sheet().getByRole('group', { name: '文件夹' })).toContainText('~/.tr/worktrees/demo/fresh-otter')
  })

  test('创建 closes at once and creates the worktree in the background', async () => {
    await pickAgent('终端')
    await page.keyboard.press('Meta+Enter')
    await expect(sheet()).toHaveCount(0)
    await expect(sidebar().locator('section[aria-label="demo"] [data-session-id]')).toHaveCount(2)
    const folder = join(fx.home, '.tr', 'worktrees', 'demo', 'fresh-otter')
    await expect.poll(() => existsSync(join(folder, '.env.local')), { timeout: 20_000 }).toBe(true)
    expect(readFileSync(join(folder, '.env.local'), 'utf8')).toBe('TOKEN=e2e\n')
    expect(execFileSync('git', ['branch', '--show-current'], { cwd: folder }).toString().trim()).toBe('jacob/fresh-otter')
    expect(execFileSync('git', ['config', '--get', 'branch.jacob/fresh-otter.base'], { cwd: fx.demo }).toString().trim()).toBe('main')
    // The new session's terminal starts once the folder is there, and it is in that folder.
    const pane = page.locator('[data-region="terminal"] [data-active="true"]')
    await expect(pane.locator('.xterm')).toBeVisible({ timeout: 20_000 })
    await page.keyboard.type('pwd\n')
    await expect.poll(activeScreen, { timeout: 10_000 }).toContain('fresh-otter')
  })

  test('工作目录 is remembered per project', async () => {
    await openSheet()
    await expect(radio('新 worktree')).toHaveAttribute('aria-checked', 'true')
    await radio('当前目录').click()
    await pickAgent('终端')
    await createButton().click()
    await expect(sheet()).toHaveCount(0)
    await expect(sidebar().locator('section[aria-label="demo"] [data-session-id]')).toHaveCount(3)
    await openSheet()
    await expect(radio('当前目录')).toHaveAttribute('aria-checked', 'true')
    await radio('新 worktree').click()
  })

  test('a branch that is already in a worktree opens another session there', async () => {
    await sheet().getByRole('button', { name: '基于' }).click()
    await page.getByRole('listbox', { name: '基于' }).getByRole('option', { name: /jacob\/checkout-coupon/ }).click()
    await expect(sheet().getByRole('group', { name: '基于' })).toContainText('已在 worktree 里：会在')
    await expect(sheet().getByRole('button', { name: /高级/ })).toHaveCount(0)
    await pickAgent('终端')
    await createButton().click()
    await expect(sheet()).toHaveCount(0)
    const pane = page.locator('[data-region="terminal"] [data-active="true"]')
    await expect(pane.locator('.xterm')).toBeVisible({ timeout: 20_000 })
    await page.keyboard.type('pwd\n')
    await expect.poll(activeScreen, { timeout: 10_000 }).toContain('wt-coupon')
  })

  test('15F: a folder that is not a git repository can only start in itself', async () => {
    await openSheet()
    await sheet().getByRole('button', { name: '项目' }).click()
    await page.getByRole('listbox', { name: '项目' }).getByRole('option', { name: 'notes' }).click()
    await expect(radio('新 worktree')).toBeDisabled()
    await expect(radio('当前目录')).toHaveAttribute('aria-checked', 'true')
    await expect(sheet()).toContainText('这个文件夹不是 git 仓库，只能在当前目录里开')
    await expect(sheet().getByRole('button', { name: '基于' })).toHaveCount(0)
    await shoot('15f-not-a-repo')
    await page.keyboard.press('Escape')
    await expect(sheet()).toHaveCount(0)
  })
})
