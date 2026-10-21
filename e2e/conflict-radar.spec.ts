// Conflict radar on a real repository with three worktrees and a fake `claude` in each: jacob/a and jacob/b edit the
// same README line (they conflict with each other), jacob/c edits another file. The overview list and the overlay's
// title bar say "和 jacob/b 会冲突"; after a squash merge of jacob/a into main (by hand, in the main checkout) jacob/b
// would conflict with main and jacob/c is behind it; 让 agent rebase in the Worktree view puts the rebase note into
// jacob/b's agent input line without pressing Enter. Screenshots in both themes go to test-results/conflict-radar/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeClaude } from './fake-claude'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'conflict-radar')
const WITHIN = { timeout: 30_000 }
const README = ['# demo', '', 'one', 'two', 'three', 'four', 'five', ''].join('\n')

function setup() {
  const fake = fakeClaude('tr-e2e-radar-')
  const project = join(fake.root, 'demo')
  const paths = { a: join(fake.root, 'wt-a'), b: join(fake.root, 'wt-b'), c: join(fake.root, 'wt-c') }
  mkdirSync(project)
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  const commitIn = (cwd: string, file: string, text: string, message: string) => {
    writeFileSync(join(cwd, file), text)
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', message)
  }
  git(project, 'init', '-q', '-b', 'main')
  writeFileSync(join(project, 'notes.md'), 'notes\n')
  commitIn(project, 'README.md', README, 'init')
  for (const [name, path] of Object.entries(paths)) {
    git(project, 'worktree', 'add', '-q', '-b', `jacob/${name}`, path)
    git(project, 'config', `branch.jacob/${name}.base`, 'main')
  }
  commitIn(paths.a, 'README.md', README.replace('three', 'three from a'), 'a edits three')
  commitIn(paths.b, 'README.md', README.replace('three', 'three from b'), 'b edits three')
  commitIn(paths.c, 'notes.md', 'notes from c\n', 'c edits notes')
  return { ...fake, project, ...paths, git }
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('conflict radar', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-radar-profile-'))
  const repo = setup()
  let app: ElectronApplication
  let page: Page

  const overview = () => page.locator('[data-region="overview"]')
  const radarCell = (id: string) => overview().locator(`[data-session-id="${id}"] [data-testid="overview-radar"]`)
  const panel = () => page.locator('[data-region="panel"]')
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
          { id: 'w-a', projectId: 'p1', branch: 'jacob/a', path: repo.a, isMain: false, baseBranch: 'main' },
          { id: 'w-b', projectId: 'p1', branch: 'jacob/b', path: repo.b, isMain: false, baseBranch: 'main' },
          { id: 'w-c', projectId: 'p1', branch: 'jacob/c', path: repo.c, isMain: false, baseBranch: 'main' }
        ],
        sessions: [
          { id: 's-a', worktreeId: 'w-a', kind: 'claude', title: '标题改成三', startedAt: 1, lastActivityAt: 1 },
          { id: 's-b', worktreeId: 'w-b', kind: 'claude', title: '也改第三行', startedAt: 2, lastActivityAt: 2 },
          { id: 's-c', worktreeId: 'w-c', kind: 'claude', title: '补充笔记', startedAt: 3, lastActivityAt: 3 }
        ],
        activeSessionId: 's-b',
        sidebarCollapsed: false,
        drafts: {}
      })
    )
    app = await launchApp(repo.env, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('the overview marks the two worktrees that conflict with each other, and not the clean one', async () => {
    await page.keyboard.press('Meta+Shift+A')
    await expect(radarCell('s-a')).toHaveText('和 jacob/b 会冲突', WITHIN)
    await expect(radarCell('s-b')).toHaveText('和 jacob/a 会冲突')
    await expect(radarCell('s-c')).toHaveText('')
    // The files are in the tooltip (and the accessible name), not only color: the tag has an icon and text.
    await expect(radarCell('s-a').getByTestId('radar-tag')).toHaveAttribute('title', '和 jacob/b 会冲突：README.md')
    await expect(radarCell('s-a').getByTestId('radar-tag')).toHaveAttribute('data-tone', 'conflict')
    await shoot('overview')
  })

  test('the board overlay says it in the title bar', async () => {
    await overview().getByRole('radio', { name: '看板' }).click()
    await overview().locator('[data-session-id="s-a"]').click()
    const bar = page.locator('[data-pane-id="s-a"] header')
    await expect(bar.getByTestId('radar-tag')).toHaveText('和 jacob/b 会冲突', WITHIN)
    await shoot('overlay')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-pane-id="s-a"]')).toHaveCount(0)
    await overview().getByRole('radio', { name: '列表' }).click()
  })

  test('after jacob/a lands on main: jacob/b would conflict with main, jacob/c is behind, jacob/a drops out', async () => {
    repo.git(repo.project, 'merge', '--squash', '-q', 'jacob/a')
    repo.git(repo.project, 'commit', '-q', '-m', 'Squash jacob/a')
    await expect(radarCell('s-b')).toHaveText('和 main 会冲突', WITHIN)
    await expect(radarCell('s-c')).toHaveText('main 已前进 · 落后 1', WITHIN)
    await expect(radarCell('s-a')).toHaveText('')
    await expect(radarCell('s-c').getByTestId('radar-tag')).toHaveAttribute('data-tone', 'behind')
    await shoot('after-merge')
    await page.keyboard.press('Escape')
    await expect(overview()).toHaveCount(0)
  })

  test('the Worktree view lists the conflict and 让 agent rebase puts the note into the input line, not sent', async () => {
    await page.locator('header').getByRole('group', { name: '右侧栏' }).getByRole('button', { name: 'Worktree' }).click()
    await expect(panel().getByRole('heading', { name: 'Worktree' })).toBeVisible()
    const rowB = panel().locator(`li[data-path$="/wt-b"]`)
    await expect(rowB.getByTestId('radar-tag')).toHaveText('和 main 会冲突', WITHIN)
    await expect(panel().locator(`li[data-path$="/wt-c"]`).getByTestId('radar-tag')).toHaveText('main 已前进 · 落后 1')
    await rowB.getByRole('button').first().click()
    await expect(rowB.getByTestId('radar-detail').first()).toHaveText(/冲突main · README\.md/)
    await shoot('worktree-view')

    const rebase = rowB.getByRole('button', { name: '让 agent rebase' })
    await expect(rebase).toHaveAttribute('title', '把 rebase 说明放进 Claude 的输入行，看过后按回车发送')
    await rebase.click()
    await expect.poll(repo.typed, WITHIN).toContain('完成后告诉我。')
    expect(repo.typed()).toContain('main 已经合入了别的改动，jacob/b 落后 1 个提交。rebase 时会冲突：README.md（两边都改了同一处）。')
    expect(repo.typed()).toContain('GIT_EDITOR=true git rebase main')
    expect(repo.logged()).not.toContain('<ENTER>')
  })
})
