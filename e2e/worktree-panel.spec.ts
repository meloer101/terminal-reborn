// F17 right panel · Worktree view on a real repository: a main checkout plus linked worktrees — one with a session and
// uncommitted work, one merged into main without a session, one merged but still with a session, one detached with a
// commit no branch has. Checks the rows and groups, switching sessions, the selected row's details, the delete guards
// and that 可清理 › 清理 never touches a worktree with a session. Screenshots in both themes go to test-results/right-panel/ (compare with Figma 13C).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'right-panel')

interface DialogHook {
  requests: { message: string; detail?: string }[]
  answer: boolean
}

/**
 * main · feature (1 commit ahead, behind after the merges, one uncommitted line) · merged (merged with --no-ff, no
 * session) · busy (merged, but a session works there) · detached (a commit that only it has).
 */
function makeRepo(): { project: string; feature: string; merged: string; busy: string; detached: string } {
  const base = mkdtempSync(join(tmpdir(), 'tr-e2e-worktrees-'))
  const project = join(base, 'demo')
  const feature = join(base, 'wt-feature')
  const merged = join(base, 'wt-merged')
  const busy = join(base, 'wt-busy')
  const detached = join(base, 'wt-detached')
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd })
  const commitIn = (cwd: string, file: string) => {
    writeFileSync(join(cwd, file), `export const x = '${file}'\n`)
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', file)
  }
  execFileSync('mkdir', ['-p', project])
  writeFileSync(join(project, 'README.md'), '# demo\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'add', '.')
  git(project, 'commit', '-q', '-m', 'init')

  git(project, 'worktree', 'add', '-q', '-b', 'jacob/feature', feature)
  commitIn(feature, 'feature.ts')
  writeFileSync(join(feature, 'README.md'), '# demo\nwork in progress\n')

  for (const [path, branch] of [
    [merged, 'jacob/merged'],
    [busy, 'jacob/busy']
  ] as const) {
    git(project, 'worktree', 'add', '-q', '-b', branch, path)
    commitIn(path, `${branch.slice(6)}.ts`)
    git(project, 'merge', '-q', '--no-ff', '-m', `merge ${branch}`, branch)
  }

  git(project, 'worktree', 'add', '-q', '--detach', detached)
  commitIn(detached, 'only-here.ts')
  return { project, feature, merged, busy, detached }
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
  const idle = () => panel().getByRole('list', { name: '没有会话' })
  // Rows carry git's path: the tmp folder resolved (/var → /private/var), while the workspace keeps the unresolved one.
  const real = new Map([repo.project, repo.feature, repo.merged, repo.busy, repo.detached].map((p) => [p, realpathSync(p)]))
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
          { id: 'w-feature', projectId: 'p1', branch: 'jacob/feature', path: repo.feature, isMain: false },
          { id: 'w-busy', projectId: 'p1', branch: 'jacob/busy', path: repo.busy, isMain: false }
        ],
        sessions: [
          { id: 's-main', worktreeId: 'w-main', kind: 'shell', title: '主终端', startedAt: 1, lastActivityAt: 1 },
          { id: 's-feature', worktreeId: 'w-feature', kind: 'shell', title: 'Cookie 会话迁移', startedAt: 2, lastActivityAt: 2 },
          { id: 's-busy', worktreeId: 'w-busy', kind: 'shell', title: '还在看的', startedAt: 3, lastActivityAt: 3 }
        ],
        activeSessionId: 's-main',
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
    app = await launchApp({}, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('lists every worktree with its session, uncommitted stats and ahead / behind', async () => {
    await page.locator('header').getByRole('group', { name: '右侧栏' }).getByRole('button', { name: 'Worktree' }).click()
    await expect(panel().getByRole('heading', { name: 'Worktree' })).toBeVisible()
    await expect(panel()).toContainText('demo')

    await expect(working().locator(':scope > li')).toHaveCount(3)
    const main = item(repo.project)
    await expect(main).toContainText('main')
    await expect(main).toContainText('主目录 · 主终端 · 终端')
    await expect(main).toContainText('—')
    // The main row is the active session's worktree: it starts expanded.
    await expect(main.getByRole('button', { name: /main/ }).first()).toHaveAttribute('aria-expanded', 'true')

    const feature = item(repo.feature)
    await expect(feature).toContainText('jacob/feature')
    await expect(feature).toContainText('+1 −0')
    await expect(feature).toContainText('↑1 ↓4')
    await expect(feature).toContainText('Cookie 会话迁移 · 终端')

    await expect(panel().getByRole('heading', { name: '可清理' })).toBeVisible()
    await expect(cleanable().locator(':scope > li')).toHaveCount(1)
    await expect(item(repo.merged)).toContainText('jacob/merged')
    await expect(item(repo.merged)).toContainText('无会话 · 已合并到 main')
    await expect(item(repo.merged)).toContainText('↑0 ↓3')
    // Merged, but a session works there: it stays in the working list.
    await expect(item(repo.busy)).toContainText('还在看的 · 终端 · 已合并到 main')
    await expect(working().locator(`li[data-path="${real.get(repo.busy)}"]`)).toHaveCount(1)

    await expect(panel().getByRole('heading', { name: '没有会话' })).toBeVisible()
    await expect(idle().locator(':scope > li')).toHaveCount(1)
    await expect(item(repo.detached)).toContainText('无会话')
  })

  test("clicking a row switches to its session and expands the details", async () => {
    await item(repo.feature).locator('button[aria-expanded]').click()
    await expect(page.locator('header h1')).toHaveText('Cookie 会话迁移')
    const feature = item(repo.feature)
    await expect(feature.locator('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'true')
    await expect(feature).toContainText('基线main · 领先 1，落后 4')
    await expect(feature).toContainText('未提交README.md')
    await expect(feature).toContainText(/端口段\d+\u2013\d+/)
    await expect(feature.getByRole('button', { name: /合并到 main/ })).toBeEnabled()
    await shoot('13c-worktree')

    // A worktree without a session only expands; the active session stays.
    await item(repo.merged).locator('button[aria-expanded]').click()
    await expect(item(repo.merged).locator('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('header h1')).toHaveText('Cookie 会话迁移')
  })

  test('a merged worktree offers no 合并到 main…, and ⇧⌘M only says it is merged (Figma 30B / 30D)', async () => {
    await item(repo.busy).locator('button[aria-expanded]').click()
    const busy = item(repo.busy)
    await expect(page.locator('header h1')).toHaveText('还在看的')
    await expect(busy.locator('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'true')
    // The row's own button reads “… · 已合并到 main”; the action starts with 合并到.
    await expect(busy.getByRole('button', { name: /^合并到/ })).toHaveCount(0)
    // The action is a gray block whose left edge is the label column (Figma 30D).
    const open = busy.getByRole('button', { name: '打开文件夹' })
    expect(await open.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
    const labelX = await busy.getByText('基线', { exact: true }).evaluate((el) => el.getBoundingClientRect().left)
    const openX = await open.evaluate((el) => el.getBoundingClientRect().left)
    expect(Math.abs(openX - labelX)).toBeLessThan(0.5)
    await shoot('30d-worktree-merged')

    await page.keyboard.press('Meta+Shift+KeyM')
    const sheet = page.getByTestId('merge-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('jacob/busy 已经全部合并到 main')
    await expect(sheet.getByRole('button', { name: /关闭/ })).toBeVisible()
    for (const name of ['合并', '先审阅', '取消']) await expect(sheet.getByRole('button', { name, exact: true })).toHaveCount(0)
    await shoot('30b-merge-nothing')
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
  })

  test('deleting a worktree with uncommitted changes is refused before any confirmation', async () => {
    await item(repo.feature).locator('button[aria-expanded]').click()
    await item(repo.feature).getByRole('button', { name: '更多' }).click()
    await page.getByRole('menuitem', { name: '删除 worktree…' }).click()
    await expect(panel().getByRole('status')).toHaveText('不能删除 jacob/feature：有 1 个未提交的改动，先提交或丢弃')
    expect(await dialogs()).toEqual([])
    expect(existsSync(repo.feature)).toBe(true)
  })

  test('deleting a detached worktree whose commit no branch has is refused', async () => {
    await item(repo.detached).locator('button[aria-expanded]').click()
    await expect(item(repo.detached)).toContainText('1 个提交不在分支上')
    await item(repo.detached).getByRole('button', { name: '更多' }).click()
    await page.getByRole('menuitem', { name: '删除 worktree…' }).click()
    await expect(panel().getByRole('status')).toHaveText(/^不能删除 .+：有 1 个提交不在任何分支上，先给它建一个分支$/)
    expect(await dialogs()).toEqual([])
    expect(existsSync(repo.detached)).toBe(true)
  })

  test('清理 asks once, removes only the session-less merged worktree, never one with a session', async () => {
    await panel().getByRole('button', { name: '清理' }).click()
    await expect(panel().getByRole('status')).toHaveText('已清理 1 个 worktree')
    const asked = await dialogs()
    expect(asked).toHaveLength(1)
    expect(asked[0]!.message).toBe('清理 1 个 worktree？')
    expect(asked[0]!.detail).toContain('jacob/merged')
    expect(existsSync(repo.merged)).toBe(false)
    await expect(panel().getByRole('heading', { name: '可清理' })).toHaveCount(0)
    await expect(working().locator(':scope > li')).toHaveCount(3)
    // The branch is kept.
    expect(execFileSync('git', ['branch', '--list', 'jacob/merged'], { cwd: repo.project }).toString()).toContain('jacob/merged')
  })
})
