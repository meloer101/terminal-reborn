// F17 right panel · Worktree view on a real repository: a main checkout plus two linked worktrees, one with a session
// and uncommitted work, one already merged into main. Checks the rows, switching sessions, the selected row's details,
// the delete guard and 可清理 › 清理. Screenshots in both themes go to test-results/right-panel/ (compare with Figma 13C).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'right-panel')

interface DialogHook {
  requests: { message: string; detail?: string }[]
  answer: boolean
}

/** main · feature (1 commit ahead, 2 behind after the merge, one uncommitted line) · merged (merged into main with --no-ff, so main moved on). */
function makeRepo(): { project: string; feature: string; merged: string } {
  const base = mkdtempSync(join(tmpdir(), 'tr-e2e-worktrees-'))
  const project = join(base, 'demo')
  const feature = join(base, 'wt-feature')
  const merged = join(base, 'wt-merged')
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd })
  execFileSync('mkdir', ['-p', project])
  writeFileSync(join(project, 'README.md'), '# demo\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'add', '.')
  git(project, 'commit', '-q', '-m', 'init')

  git(project, 'worktree', 'add', '-q', '-b', 'jacob/feature', feature)
  writeFileSync(join(feature, 'feature.ts'), 'export const feature = 1\n')
  git(feature, 'add', '.')
  git(feature, 'commit', '-q', '-m', 'feature')
  writeFileSync(join(feature, 'README.md'), '# demo\nwork in progress\n')

  git(project, 'worktree', 'add', '-q', '-b', 'jacob/merged', merged)
  writeFileSync(join(merged, 'merged.ts'), 'export const merged = 1\n')
  git(merged, 'add', '.')
  git(merged, 'commit', '-q', '-m', 'merged work')
  git(project, 'merge', '-q', '--no-ff', '-m', 'merge jacob/merged', 'jacob/merged')
  return { project, feature, merged }
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

test.describe('F17 right panel · Worktree', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-wtpanel-'))
  const repo = makeRepo()
  let app: ElectronApplication
  let page: Page

  const panel = () => page.locator('[data-region="panel"]')
  const working = () => panel().getByRole('list', { name: 'Worktree' })
  const cleanable = () => panel().getByRole('list', { name: '可清理' })
  // Rows carry git's path: the tmp folder resolved (/var → /private/var), while the workspace keeps the unresolved one.
  const real = new Map([repo.project, repo.feature, repo.merged].map((p) => [p, realpathSync(p)]))
  const item = (path: string) => panel().locator(`li[data-path="${real.get(path) ?? path}"]`)
  const dialogs = () => app.evaluate(() => (globalThis as unknown as { __trDialogs: DialogHook }).__trDialogs.requests.map((r) => ({ ...r })))
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
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: repo.project }],
        worktrees: [
          { id: 'w-main', projectId: 'p1', branch: 'main', path: repo.project, isMain: true },
          { id: 'w-feature', projectId: 'p1', branch: 'jacob/feature', path: repo.feature, isMain: false }
        ],
        sessions: [
          { id: 's-main', worktreeId: 'w-main', kind: 'shell', title: '主终端', startedAt: 1, lastActivityAt: 1 },
          { id: 's-feature', worktreeId: 'w-feature', kind: 'shell', title: 'Cookie 会话迁移', startedAt: 2, lastActivityAt: 2 }
        ],
        activeSessionId: 's-main',
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
  })

  test('lists every worktree with its session, uncommitted stats and ahead / behind', async () => {
    await page.locator('header').getByRole('group', { name: '右侧栏' }).getByRole('button', { name: 'Worktree' }).click()
    await expect(panel().getByRole('heading', { name: 'Worktree' })).toBeVisible()
    await expect(panel()).toContainText('demo')

    await expect(working().locator(':scope > li')).toHaveCount(2)
    const main = item(repo.project)
    await expect(main).toContainText('main')
    await expect(main).toContainText('主目录 · 主终端 · 终端')
    await expect(main).toContainText('—')
    // The main row is the active session's worktree: it starts expanded.
    await expect(main.getByRole('button', { name: /main/ }).first()).toHaveAttribute('aria-expanded', 'true')

    const feature = item(repo.feature)
    await expect(feature).toContainText('jacob/feature')
    await expect(feature).toContainText('+1 −0')
    await expect(feature).toContainText('↑1 ↓2')
    await expect(feature).toContainText('Cookie 会话迁移 · 终端')

    await expect(panel().getByRole('heading', { name: '可清理' })).toBeVisible()
    await expect(cleanable().locator(':scope > li')).toHaveCount(1)
    await expect(item(repo.merged)).toContainText('jacob/merged')
    await expect(item(repo.merged)).toContainText('无会话 · 已合并到 main')
    await expect(item(repo.merged)).toContainText('↑0 ↓1')
  })

  test("clicking a row switches to its session and expands the details", async () => {
    await item(repo.feature).locator('button[aria-expanded]').click()
    await expect(page.locator('header h1')).toHaveText('Cookie 会话迁移')
    const feature = item(repo.feature)
    await expect(feature.locator('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'true')
    await expect(feature).toContainText('基线main · 领先 1，落后 2')
    await expect(feature).toContainText('未提交README.md')
    await expect(feature.getByRole('button', { name: /合并到 main/ })).toHaveAttribute('aria-disabled', 'true')
    await shoot('13c-worktree')

    // A worktree without a session only expands; the active session stays.
    await item(repo.merged).locator('button[aria-expanded]').click()
    await expect(item(repo.merged).locator('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('header h1')).toHaveText('Cookie 会话迁移')
  })

  test('deleting a worktree with uncommitted changes is refused before any confirmation', async () => {
    await item(repo.feature).locator('button[aria-expanded]').click()
    await item(repo.feature).getByRole('button', { name: '更多' }).click()
    await page.getByRole('menuitem', { name: '删除 worktree…' }).click()
    await expect(panel().getByRole('status')).toHaveText('不能删除 jacob/feature：有 1 个未提交的改动，先提交或丢弃')
    expect(await dialogs()).toEqual([])
    expect(existsSync(repo.feature)).toBe(true)
  })

  test('清理 asks once, listing the worktrees, then removes them', async () => {
    await panel().getByRole('button', { name: '清理' }).click()
    await expect(panel().getByRole('status')).toHaveText('已清理 1 个 worktree')
    const asked = await dialogs()
    expect(asked).toHaveLength(1)
    expect(asked[0]!.message).toBe('清理 1 个 worktree？')
    expect(asked[0]!.detail).toContain('jacob/merged')
    expect(existsSync(repo.merged)).toBe(false)
    await expect(panel().getByRole('heading', { name: '可清理' })).toHaveCount(0)
    await expect(working().locator(':scope > li')).toHaveCount(2)
    // The branch is kept.
    expect(execFileSync('git', ['branch', '--list', 'jacob/merged'], { cwd: repo.project }).toString()).toContain('jacob/merged')
  })
})
