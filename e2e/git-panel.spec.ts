// F17 Git view (F6 graph + F5 changes) on a real repo: a merged branch, an unmerged one, a tag and a linked worktree
// with its own session. Checks rows, lanes, GraphRef pills, switching sessions from a worktree pill, the 仅 worktree
// filter, and the 变更 groups with an expanded diff. Screenshots in both themes go to test-results/git-panel/
// (compare with Figma 13B / 13H / 13B2).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'git-panel')
const MAIN_SESSION = 's-main'
const NAV_SESSION = 's-nav'

/**
 * main: init → nav merged (--no-ff) → release (tagged v1.0) → HEAD
 * fix-lcp: one unmerged commit off init; jacob/mobile-nav: a linked worktree two commits ahead of main.
 */
function makeRepo(): { project: string; linked: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tr-e2e-git-')))
  const project = join(root, 'acme-web')
  const linked = join(root, 'mobile-nav')
  mkdirSync(join(project, 'src'), { recursive: true })
  let hoursAgo = 30
  const git = (cwd: string, ...args: string[]) => {
    const date = new Date(Date.now() - hoursAgo * 3600_000).toISOString()
    return execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
      cwd,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
    }).toString()
  }
  const commit = (cwd: string, file: string, text: string, message: string) => {
    writeFileSync(join(cwd, file), text)
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', message)
    hoursAgo -= 1
  }
  git(project, 'init', '-q', '-b', 'main')
  commit(project, 'src/app.ts', 'export const app = 1\n', 'Initial commit')
  git(project, 'checkout', '-q', '-b', 'fix-lcp')
  commit(project, 'src/hero.ts', 'export const hero = 1\n', 'Preload hero image')
  git(project, 'checkout', '-q', 'main')
  git(project, 'checkout', '-q', '-b', 'nav')
  commit(project, 'src/nav.ts', 'export const nav = 1\n', 'Add nav')
  commit(project, 'src/nav.ts', 'export const nav = 2\n', 'Make nav sticky')
  git(project, 'checkout', '-q', 'main')
  commit(project, 'README.md', '# acme\n', 'Add readme')
  git(project, 'merge', '-q', '--no-ff', '-m', "Merge branch 'nav'", 'nav')
  hoursAgo -= 1
  commit(project, 'src/app.ts', 'export const app = 2\n', 'Release v1.0')
  git(project, 'tag', '-a', 'v1.0', '-m', 'v1.0')
  git(project, 'worktree', 'add', '-q', '-b', 'jacob/mobile-nav', linked, 'main')
  const navLines = Array.from({ length: 8 }, (_, i) => `export const step${i} = ${i}`)
  commit(linked, 'src/mobile-nav.ts', `${navLines.join('\n')}\n`, 'Add mobile nav')
  navLines[3] = 'export const step3 = Math.max(scrollY, 0)'
  commit(linked, 'src/mobile-nav.ts', `${navLines.join('\n')}\nexport const clamp = true\n`, 'Clamp scrollY during iOS bounce')
  // 未提交 in the main checkout: a modified file and an untracked one.
  writeFileSync(join(project, 'src', 'app.ts'), 'export const app = 3\nexport const extra = true\n')
  writeFileSync(join(project, 'notes.md'), 'todo\n')
  return { project, linked }
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('F17 right panel · Git', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-git-panel-'))
  const { project, linked } = makeRepo()
  let app: ElectronApplication
  let page: Page

  const panel = () => page.locator('[data-region="panel"]')
  const graph = () => panel().getByRole('list', { name: '提交' })
  const commitRow = (subject: string) => graph().getByRole('listitem').filter({ hasText: subject })
  const pill = (name: string) => graph().locator('[data-kind]').filter({ hasText: new RegExp(`^${name}$`) })
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
        projects: [{ id: 'p1', name: 'acme-web', rootPath: project }],
        worktrees: [
          { id: 'w1', projectId: 'p1', branch: 'main', path: project, isMain: true },
          { id: 'w2', projectId: 'p1', branch: 'jacob/mobile-nav', path: linked, isMain: false, baseBranch: 'main' }
        ],
        sessions: [
          { id: MAIN_SESSION, worktreeId: 'w1', kind: 'shell', title: 'Cookie 会话迁移', startedAt: 1, lastActivityAt: 1 },
          { id: NAV_SESSION, worktreeId: 'w2', kind: 'shell', title: '修复移动端导航抖动', startedAt: 1, lastActivityAt: 1 }
        ],
        activeSessionId: MAIN_SESSION,
        sidebarCollapsed: false,
        rightPanel: 'git',
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

  test('图谱 lists every commit with lanes and GraphRef pills', async () => {
    await expect(panel().getByRole('heading', { name: 'Git' })).toBeVisible()
    await expect(panel()).toContainText('acme-web')
    await expect(panel().getByRole('tab', { name: '图谱' })).toHaveAttribute('aria-selected', 'true')
    await expect(panel().getByRole('button', { name: '全部分支' })).toBeVisible()

    // 9 commits: init, fix-lcp, two nav, readme, merge, release, two on the linked worktree.
    await expect(graph().getByRole('listitem')).toHaveCount(9)
    // The linked worktree's commits are newest; topo order keeps each branch together.
    await expect(graph().getByRole('listitem').first()).toContainText('Clamp scrollY during iOS bounce')

    // The active session's worktree HEAD: ✓, selected row, primary subject, its worktree pill with a glyph.
    const head = commitRow('Release v1.0')
    await expect(head).toHaveAttribute('data-head', 'true')
    await expect(head.getByLabel('当前 worktree 的 HEAD')).toBeVisible()
    await expect(head.locator('[data-kind="worktree"]')).toHaveText('main')
    await expect(head.locator('[data-kind="worktree"] svg[role="img"]')).toHaveCount(1)
    await expect(head.locator('[data-kind="tag"]')).toHaveText('v1.0')

    // Branch pills: the session's worktree folds its branch in; plain branches and tags stay.
    await expect(commitRow('Clamp scrollY').locator('[data-kind="worktree"]')).toHaveText('jacob/mobile-nav')
    await expect(commitRow('Preload hero image').locator('[data-kind="local"]')).toHaveText('fix-lcp')
    await expect(commitRow('Make nav sticky').locator('[data-kind="local"]')).toHaveText('nav')
    await expect(pill('main')).toHaveCount(1)

    // Lanes: the merge leaves its node twice (first parent down, second parent sideways); nodes are circles.
    const merge = commitRow("Merge branch 'nav'")
    await expect(merge.locator('svg path')).not.toHaveCount(0)
    const mergePaths = await merge.locator('svg path').evaluateAll((paths) => paths.map((p) => p.getAttribute('d') ?? ''))
    expect(mergePaths.some((d) => d.includes('A8 8'))).toBe(true)
    // The trunk stays in column 0 (x = 18) even though the linked worktree's commits come first.
    await expect(head.locator('circle[data-node]')).toHaveAttribute('cx', '18')
    await expect(head.locator('circle[data-node]')).toHaveAttribute('r', '5')
    await expect(commitRow('Preload hero image').locator('circle[data-node]')).not.toHaveAttribute('cx', '18')

    await page.locator('[data-region="panel"]').hover()
    await shoot('graph')
  })

  test('仅 worktree hides branches no worktree reaches', async () => {
    await panel().getByRole('button', { name: '全部分支' }).click()
    await page.getByRole('menuitem', { name: '仅 worktree' }).click()
    await expect(graph().getByRole('listitem')).toHaveCount(8)
    await expect(commitRow('Preload hero image')).toHaveCount(0)
    await panel().getByRole('button', { name: '仅 worktree' }).click()
    await page.getByRole('menuitem', { name: '全部分支' }).click()
    await expect(graph().getByRole('listitem')).toHaveCount(9)
  })

  test('变更 groups uncommitted files and expands a diff', async () => {
    const tab = panel().getByRole('tab', { name: /^变更/ })
    await expect(tab).toHaveText('变更 2')
    await tab.click()
    const files = panel().getByRole('list', { name: '改动的文件' })
    await expect(files.locator('[data-group="uncommitted"]')).toHaveCount(2)
    await expect(files.locator('[data-path="notes.md"]')).toContainText('+1')
    // main is the base itself and has no upstream: nothing to compare against.
    await expect(files).toContainText('没有可对比的基线分支')
    await files.locator('[data-path="src/app.ts"] button').click()
    await expect(files.locator('[data-path="src/app.ts"] [data-kind="add"]')).toHaveCount(2)
    await expect(files.locator('[data-path="src/app.ts"] [data-kind="del"]')).toHaveCount(1)
    await expect(panel().getByRole('button', { name: /合并到/ })).toBeDisabled()
    await expect(panel().getByRole('button', { name: '创建 PR' })).toBeDisabled()
    await panel().getByRole('tab', { name: '图谱' }).click()
  })

  test('a worktree pill switches to its session; 变更 there compares against the base', async () => {
    await commitRow('Clamp scrollY').locator('[data-kind="worktree"]').click()
    await expect(page.locator('header')).toContainText('修复移动端导航抖动')
    // The panel follows the new session's worktree: its HEAD now carries the ✓.
    await expect(commitRow('Clamp scrollY')).toHaveAttribute('data-head', 'true')
    await expect(commitRow('Release v1.0')).not.toHaveAttribute('data-head', 'true')

    await panel().getByRole('tab', { name: /^变更/ }).click()
    const files = panel().getByRole('list', { name: '改动的文件' })
    await expect(panel()).toContainText('jacob/mobile-nav')
    await expect(panel()).toContainText('领先 2 · 落后 0')
    await expect(files).toContainText('2 个提交 · 对比 main')
    await expect(files.locator('[data-group="committed"]')).toHaveCount(1)
    await files.locator('[data-path="src/mobile-nav.ts"] button').click()
    await expect(files.locator('[data-path="src/mobile-nav.ts"] [data-kind="add"]')).toHaveCount(9)
    await expect(panel().getByRole('button', { name: /合并到 main/ })).toBeVisible()
    await shoot('changes')
  })

  test('a new commit shows up without a manual refresh', async () => {
    await panel().getByRole('tab', { name: '图谱' }).click()
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'Agent commit'], {
      cwd: linked
    })
    await expect(commitRow('Agent commit')).toHaveAttribute('data-head', 'true', { timeout: 10_000 })
    await expect(graph().getByRole('listitem')).toHaveCount(10)
  })
})
