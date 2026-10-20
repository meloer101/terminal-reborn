// F15 archive on a real repository with a fake `claude` (see fake-claude.ts): right-click 归档 worktree…, the 16D
// sheet, the repository's `archive` script, the private ref, the worktree folded out of the sidebar; then its folder is
// removed and ⌘K 历史 brings it back — branch, uncommitted and untracked files — and the agent resumes its
// conversation with `--resume`. Screenshots in both themes go to test-results/archive/ (compare with Figma 16D).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeClaude } from './fake-claude'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'archive')
const WITHIN = { timeout: 30_000 }

function setup() {
  const fake = fakeClaude('tr-e2e-archive-')
  const project = join(fake.root, 'demo')
  const wt = join(fake.root, 'wt-nav')
  mkdirSync(project)
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  writeFileSync(join(project, 'README.md'), '# demo\n')
  mkdirSync(join(project, '.tr'))
  writeFileSync(join(project, '.tr', 'settings.toml'), `[scripts]\narchive = "echo archived >> ${join(fake.root, 'archive-ran.txt')}"\n`)
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'add', '.')
  git(project, 'commit', '-q', '-m', 'init')
  git(project, 'worktree', 'add', '-q', '-b', 'jacob/nav', wt)
  writeFileSync(join(wt, 'nav.ts'), "export const nav = 'sticky'\n")
  git(wt, 'add', '.')
  git(wt, 'commit', '-q', '-m', 'nav')
  // Work the agent has not committed yet: an edit and a new file.
  writeFileSync(join(wt, 'nav.ts'), "export const nav = 'fixed'\n")
  writeFileSync(join(wt, 'notes.md'), 'todo\n')
  return { ...fake, project, wt, git }
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('F15 archive', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-archive-profile-'))
  const repo = setup()
  let app: ElectronApplication
  let page: Page

  const sidebar = () => page.locator('[data-region="sidebar"]')
  const sheet = () => page.getByTestId('archive-sheet')
  const refs = () => repo.git(repo.project, 'for-each-ref', '--format=%(refname)', 'refs/wavi/archive').trim()
  const setTheme = async (theme: 'dark' | 'light') => {
    await page.evaluate(
      (t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }),
      theme
    )
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
  }
  const shoot = async (name: string) => {
    mkdirSync(SHOTS, { recursive: true })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(theme)
      await page.waitForTimeout(200)
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) }).catch(() => undefined)
    }
    await setTheme('dark')
  }

  test.beforeAll(async () => {
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: repo.project }],
        worktrees: [
          { id: 'w-main', projectId: 'p1', branch: 'main', path: repo.project, isMain: true },
          { id: 'w-nav', projectId: 'p1', branch: 'jacob/nav', path: repo.wt, isMain: false, baseBranch: 'main' }
        ],
        sessions: [
          { id: 's-main', worktreeId: 'w-main', kind: 'shell', title: '主目录', startedAt: 1, lastActivityAt: 1 },
          { id: 's-nav', worktreeId: 'w-nav', kind: 'claude', title: '导航吸顶', agentSessionId: 'conv-nav-1', startedAt: 2, lastActivityAt: 2 }
        ],
        activeSessionId: 's-nav',
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
    app = await launchApp(repo.env, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => repo.launches().length, WITHIN).toBeGreaterThan(0)
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('归档 stops the session, runs the archive script, keeps the work on a private ref and folds the worktree away', async () => {
    await sidebar().locator('[data-session-id="s-nav"]').click({ button: 'right' })
    await page.getByRole('menu').getByRole('menuitem', { name: '归档 worktree…' }).click()
    await expect(sheet()).toBeVisible()
    await expect(sheet().getByRole('heading')).toHaveText('归档')
    await expect(sheet()).toContainText('jacob/nav')
    await expect(sheet()).toContainText('停止这里的会话')
    await expect(sheet()).toContainText('运行 archive：echo archived')
    await expect(sheet()).toContainText('工作区（含未提交的改动）记在本地，侧栏里先收起来')
    await expect(sheet()).toContainText('之后可以在跳转（⌘K）的历史里恢复')
    await shoot('16D-archive')

    await sheet().getByRole('button', { name: /^归档/ }).click()
    await expect(sheet()).toHaveCount(0, WITHIN)
    await expect(sidebar().locator('[data-session-id="s-nav"]')).toHaveCount(0)
    expect(readFileSync(join(repo.root, 'archive-ran.txt'), 'utf8')).toBe('archived\n')
    expect(refs()).toMatch(/^refs\/wavi\/archive\//)
    // The folder is left as it was.
    expect(readFileSync(join(repo.wt, 'notes.md'), 'utf8')).toBe('todo\n')
    type Saved = { worktrees: { id: string; archived?: unknown }[] }
    await expect
      .poll(() => (JSON.parse(readFileSync(join(profile, 'workspace.json'), 'utf8')) as Saved).worktrees.find((w) => w.id === 'w-nav')?.archived)
      .toBeTruthy()
  })

  test('⌘K 历史 brings a removed folder back with its uncommitted work, and the agent resumes its conversation', async () => {
    repo.git(repo.project, 'worktree', 'remove', '--force', repo.wt)
    expect(existsSync(repo.wt)).toBe(false)
    const launchesBefore = repo.launches().length

    await page.keyboard.press('Meta+k')
    const palette = page.getByRole('dialog').filter({ has: page.getByRole('combobox') }).first()
    await page.keyboard.type('历史')
    const row = page.locator('[data-entry-id="archived:w-nav"]')
    await expect(row).toContainText('导航吸顶')
    await expect(row).toContainText('demo · jacob/nav · 刚刚归档')
    await shoot('F15-history')
    await row.click()
    await expect(palette).toHaveCount(0)

    await expect(sidebar().locator('[data-session-id="s-nav"]')).toBeVisible(WITHIN)
    await expect.poll(() => existsSync(join(repo.wt, 'notes.md')), WITHIN).toBe(true)
    expect(readFileSync(join(repo.wt, 'nav.ts'), 'utf8')).toBe("export const nav = 'fixed'\n")
    expect(repo.git(repo.wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('jacob/nav')
    expect(refs()).toBe('')
    await expect.poll(() => repo.launches().length, WITHIN).toBeGreaterThan(launchesBefore)
    expect(repo.launches().at(-1)).toContain('--resume conv-nav-1')
  })
})
