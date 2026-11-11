// 已看 marks in Git · 变更 (合入链路 v2, PRD v1.169, Figma 73A) on a real worktree with three uncommitted files: marking
// two viewed reads `已看 2 / 3` (an open file folds when it is marked), the 未看 filter lists the one left, the marks
// survive a relaunch (workspace.json › reviewMarks), and a viewed file changed on disk reads 看过后又改了 and no longer
// counts. Screenshots of the right sidebar go to REVIEW_PROGRESS_SHOTS (default test-results/review-progress/):
// viewed-dark.png, viewed-light.png, viewed-filter-dark.png, viewed-stale-dark.png.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, setWindowSize } from './launch'

const SHOTS = process.env.REVIEW_PROGRESS_SHOTS ?? join(process.cwd(), 'test-results', 'review-progress')
const WITHIN = { timeout: 20_000 }

const gitIn = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  }).toString()

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('已看 marks (Figma 73A)', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tr-e2e-viewed-')))
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-viewed-profile-'))
  const project = join(root, 'demo')
  const wt = join(root, 'wt-review')
  mkdirSync(project)
  writeFileSync(join(project, 'README.md'), '# demo\n')
  gitIn(project, 'init', '-q', '-b', 'main')
  gitIn(project, 'add', '.')
  gitIn(project, 'commit', '-q', '-m', 'init')
  gitIn(project, 'worktree', 'add', '-q', '-b', 'jacob/review', wt)
  for (const name of ['a', 'b', 'c']) writeFileSync(join(wt, `${name}.ts`), `export const ${name} = 1\n`)

  let app: ElectronApplication
  let page: Page
  const panel = () => page.locator('[data-region="panel"]')
  const count = () => panel().getByTestId('viewed-count')
  const filter = () => panel().getByTestId('viewed-filter')
  const row = (path: string) => panel().locator(`[role="listitem"][data-path="${path}"]`)
  const mark = (path: string) => row(path).locator('[data-mark]')
  const setTheme = async (theme: 'dark' | 'light') => {
    await page.evaluate(
      (t) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: t } }),
      theme
    )
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
  }
  const shoot = async (name: string, theme: 'dark' | 'light') => {
    mkdirSync(SHOTS, { recursive: true })
    await setTheme(theme)
    await page.waitForTimeout(250)
    await panel().screenshot({ path: join(SHOTS, `${name}-${theme}.png`) })
  }
  const launch = async () => {
    app = await launchApp({}, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible(WITHIN)
    const tab = panel().getByRole('tab', { name: /^变更/ })
    await expect(tab).toBeVisible(WITHIN)
    await tab.click()
  }

  test.beforeAll(async () => {
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: project }],
        worktrees: [
          { id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true },
          { id: 'w-review', projectId: 'p1', branch: 'jacob/review', path: wt, isMain: false, baseBranch: 'main' }
        ],
        sessions: [{ id: 's-review', worktreeId: 'w-review', kind: 'shell', title: '审阅', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's-review',
        sidebarCollapsed: false,
        rightPanel: 'git',
        drafts: {}
      })
    )
    await launch()
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('marking two of three files viewed reads 已看 2 / 3; an open file folds when marked; 未看 lists the one left', async () => {
    await expect(count()).toHaveText('已看 0 / 3', WITHIN)
    await expect(filter()).toHaveText('未看 3')
    await expect(mark('a.ts')).toHaveAccessibleName('未看')

    // An open file folds when it is marked viewed, and can still be opened.
    await row('a.ts').locator('button[aria-expanded]').click()
    await expect(row('a.ts').locator('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'true')
    await mark('a.ts').click()
    await expect(mark('a.ts')).toHaveAccessibleName('已看')
    await expect(row('a.ts').locator('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'false')
    await mark('b.ts').click()
    await expect(count()).toHaveText('已看 2 / 3')
    await expect(filter()).toHaveText('未看 1')
    await row('a.ts').locator('button[aria-expanded]').click()
    await expect(row('a.ts').locator('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'true')
    await row('a.ts').locator('button[aria-expanded]').click()
    await expect(row('a.ts').locator('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'false')

    await shoot('viewed', 'dark')
    await shoot('viewed', 'light')
    await setTheme('dark')

    await filter().click()
    await expect(filter()).toHaveAttribute('aria-pressed', 'true')
    await expect(panel().locator('[role="listitem"][data-path]')).toHaveCount(1)
    await expect(row('c.ts')).toBeVisible()
    await expect(panel()).toContainText('未提交')
    await shoot('viewed-filter', 'dark')
    // Everything viewed: the list is empty, the group header stays, nothing else is said.
    await mark('c.ts').click()
    await expect(panel().locator('[role="listitem"][data-path]')).toHaveCount(0)
    await expect(count()).toHaveText('已看 3 / 3')
    await filter().click()
    await expect(filter()).toHaveAttribute('aria-pressed', 'false')
    await mark('c.ts').click()
    await expect(count()).toHaveText('已看 2 / 3')
  })

  test('the marks survive a relaunch; a viewed file changed on disk reads 看过后又改了 and no longer counts', async () => {
    const file = join(profile, 'workspace.json')
    await expect
      .poll(() => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { reviewMarks?: Record<string, Record<string, string>> }).reviewMarks?.[wt] : undefined), WITHIN)
      .toMatchObject({ 'uncommitted:a.ts': expect.any(String), 'uncommitted:b.ts': expect.any(String) })
    await app.close()
    await launch()
    await expect(count()).toHaveText('已看 2 / 3', WITHIN)
    await expect(mark('a.ts')).toHaveAccessibleName('已看')
    await expect(mark('b.ts')).toHaveAccessibleName('已看')
    await expect(mark('c.ts')).toHaveAccessibleName('未看')

    appendFileSync(join(wt, 'a.ts'), 'export const more = 2\n')
    await expect(mark('a.ts')).toHaveAccessibleName('看过后又改了', WITHIN)
    await expect(count()).toHaveText('已看 1 / 3')
    await expect(filter()).toHaveText('未看 2')
    await shoot('viewed-stale', 'dark')
    // A stale mark is marked viewed again with one click.
    await mark('a.ts').click()
    await expect(mark('a.ts')).toHaveAccessibleName('已看')
    await expect(count()).toHaveText('已看 2 / 3')
  })
})
