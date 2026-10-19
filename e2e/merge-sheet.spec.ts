// F4 local merge and F13 让 agent 审阅 on a real repository, with a fake `claude` (a shell script first on the login
// shell's PATH via a throwaway ZDOTDIR) that logs every line it reads. Worktrees: jacob/clean (two commits, merges
// cleanly) and jacob/conflict (edits the README that main also edited). Checks the review command reaches the agent,
// a squash merge lands on main and removes the worktree, and a conflict is listed and put into the agent's input line (sent only when the user presses Enter), unmerged.
// Screenshots in both themes go to test-results/merge-sheet/ (compare with Figma 05).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeClaude } from './fake-claude'
import { launchApp } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'merge-sheet')
const WITHIN = { timeout: 30_000 }

function setup() {
  const fake = fakeClaude('tr-e2e-merge-')
  const project = join(fake.root, 'demo')
  const clean = join(fake.root, 'wt-clean')
  const conflict = join(fake.root, 'wt-conflict')
  mkdirSync(project)

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  const commitIn = (cwd: string, file: string, text: string, message: string) => {
    writeFileSync(join(cwd, file), text)
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', message)
  }
  writeFileSync(join(project, 'README.md'), '# demo\n')
  mkdirSync(join(project, '.tr'))
  writeFileSync(join(project, '.tr', 'settings.toml'), '[scripts]\ntest = "exit 0"\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'add', '.')
  git(project, 'commit', '-q', '-m', 'init')
  for (const [path, branch] of [
    [clean, 'jacob/clean'],
    [conflict, 'jacob/conflict']
  ] as const) {
    git(project, 'worktree', 'add', '-q', '-b', branch, path)
    git(project, 'config', `branch.${branch}.base`, 'main')
  }
  commitIn(clean, 'nav.ts', "export const nav = 'sticky'\n", 'Make nav sticky')
  commitIn(clean, 'nav.test.ts', 'test("nav")\n', 'Test nav')
  commitIn(conflict, 'README.md', '# demo\nfrom the branch\n', 'Branch edits README')
  commitIn(project, 'README.md', '# demo\nfrom main\n', 'Main edits README')
  return { ...fake, project, clean, conflict, git }
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('F4 merge sheet · F13 review', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-merge-profile-'))
  const repo = setup()
  let app: ElectronApplication
  let page: Page

  const panel = () => page.locator('[data-region="panel"]')
  const sheet = () => page.getByTestId('merge-sheet')
  const { logged, typed } = repo
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
          { id: 'w-clean', projectId: 'p1', branch: 'jacob/clean', path: repo.clean, isMain: false, baseBranch: 'main' },
          { id: 'w-conflict', projectId: 'p1', branch: 'jacob/conflict', path: repo.conflict, isMain: false, baseBranch: 'main' }
        ],
        sessions: [
          { id: 's-clean', worktreeId: 'w-clean', kind: 'claude', title: '导航吸顶', startedAt: 1, lastActivityAt: 1 },
          { id: 's-conflict', worktreeId: 'w-conflict', kind: 'claude', title: '改 README', startedAt: 2, lastActivityAt: 2 }
        ],
        activeSessionId: 's-clean',
        sidebarCollapsed: false,
        rightPanel: 'git',
        drafts: {}
      })
    )
    app = await launchApp(repo.env, { userDataDir: profile })
    page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  const updateSettings = (patch: unknown) =>
    page.evaluate((p) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update(p), patch)

  test('F13: 让 agent 审阅 runs a background review whose findings become comments; only ticked ones are sent', async () => {
    const finding = { path: 'nav.ts', startLine: 1, endLine: 1, side: 'new', group: 'committed', confidence: 0.9 }
    repo.reviewReply({
      summary: '两处',
      findings: [
        { ...finding, severity: 'P1', title: 'sticky 会挡住锚点', explanation: '滚动到锚点时标题被导航盖住' },
        { ...finding, severity: 'P3', title: '可以用常量', explanation: "把 'sticky' 提成常量" }
      ]
    })
    await panel().getByRole('tab', { name: /^变更/ }).click()
    const review = panel().getByRole('button', { name: '让 agent 审阅' })
    await expect(review).toBeEnabled(WITHIN)
    await review.click()
    const status = panel().getByTestId('review-status')
    await expect(status).toContainText('审阅找到 2 条（P1 1 · P3 1）', WITHIN)
    await expect(status).toContainText('花费 $0.012')
    // Read-only reviewer with the diff on stdin; nothing went into the coding session.
    expect(repo.reviewPrompt()).toContain("+export const nav = 'sticky'")
    expect(repo.reviewPrompt()).toContain('# wavi-group: committed')
    expect(logged()).not.toContain('code-review')

    await panel().locator('[data-path="nav.ts"][data-group="committed"] button').first().click()
    const p1 = panel().getByRole('note', { name: /^审阅 P1 nav\.ts:1/ })
    const p3 = panel().getByRole('note', { name: /^审阅 P3 nav\.ts:1/ })
    await expect(p1).toContainText('sticky 会挡住锚点')
    await expect(p1.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
    // P3 starts folded and unticked.
    await expect(p3).toHaveAttribute('data-folded', 'true')
    await expect(p3.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false')
    await shoot('F13-review-comments')
    await p3.getByRole('button', { name: '展开' }).click()
    await expect(p3).not.toHaveAttribute('data-folded')

    const send = panel().getByRole('button', { name: '发给 Claude · 1' })
    await send.click()
    await expect.poll(typed, WITHIN).toContain('P1 nav.ts:1')
    expect(typed()).not.toContain('可以用常量')
    // The unticked P3 stays for later; the same diff is not reviewed twice.
    await expect(p3).toBeVisible()
    await panel().getByRole('button', { name: '放弃' }).click()
    await expect(p3).toHaveCount(0)
    await panel().getByRole('button', { name: '让 agent 审阅' }).click()
    await expect(status).toContainText('这份改动已经审过')
  })

  test("F13: 审阅方式 · agent 自带命令 types /code-review into the session", async () => {
    await updateSettings({ review: { mode: 'agent-command' } })
    const review = panel().getByRole('button', { name: '让 agent 审阅' })
    await expect(review).toHaveAttribute('title', '在终端里发送 /code-review', WITHIN)
    await review.click()
    await expect.poll(logged, WITHIN).toMatch(/code-review.*<ENTER>/s)
    await updateSettings({ review: { mode: 'builtin', beforeMerge: true } })
  })

  test('F4: a clean branch squashes into main, and the worktree goes with its session', async () => {
    await panel().getByRole('button', { name: /^合并到 main/ }).click()
    await expect(sheet()).toBeVisible()
    await expect(sheet().getByRole('heading')).toHaveText('合并到 main')
    await expect(sheet()).toContainText('jacob/clean')
    await expect(sheet()).toContainText('领先 main 2 个提交')
    await expect(sheet()).toContainText('main 有 1 个新提交，可以自动合并')
    await expect(sheet()).toContainText('测试通过', WITHIN)
    await expect(sheet()).toContainText('exit 0')
    // 合并前 is on: the sheet asks again, the same diff keeps its earlier result, and nothing blocks 合并.
    await expect(sheet()).toContainText('这份改动已经审过：审阅找到 2 条', WITHIN)
    await expect(sheet().getByRole('button', { name: '先审阅' })).toBeVisible()
    await expect(sheet().getByRole('radio', { name: 'Squash' })).toHaveAttribute('aria-checked', 'true')
    await expect(sheet().getByRole('checkbox', { name: '合并后删除 worktree（保留分支）' })).toHaveAttribute('aria-checked', 'true')
    await expect(sheet().getByRole('checkbox', { name: '合并后推送到 origin' })).toBeDisabled()
    await shoot('05a-clean')

    await sheet().getByRole('button', { name: /^合并/ }).click()
    await expect(sheet()).toContainText('已合并到 main', WITHIN)
    await expect(sheet()).toContainText('已删除 worktree，分支保留')
    await shoot('05b-done')
    await sheet().getByRole('button', { name: /^完成/ }).click()
    await expect(sheet()).toHaveCount(0)

    expect(repo.git(repo.project, 'log', '-1', '--format=%B', 'main').trim()).toBe('导航吸顶\n\n- Make nav sticky\n- Test nav')
    expect(existsSync(join(repo.project, 'nav.ts'))).toBe(true)
    expect(existsSync(repo.clean)).toBe(false)
    expect(repo.git(repo.project, 'branch', '--list', 'jacob/clean').trim()).toBe('jacob/clean')
    await expect(page.locator(`[data-region="sidebar"] [data-session-id="s-clean"]`)).toHaveCount(0)
  })

  test('F4: ⇧⌘M on a conflicting branch lists the files and hands them to the agent; main does not move', async () => {
    await page.locator(`[data-region="sidebar"] [data-session-id="s-conflict"]`).click()
    await expect(page.locator('header h1')).toHaveText('改 README')
    const before = repo.git(repo.project, 'rev-parse', 'main').trim()
    await page.keyboard.press('Meta+Shift+M')
    await expect(sheet()).toBeVisible()
    await expect(sheet()).toContainText('main 有 2 个新提交，与本分支冲突')
    await expect(sheet()).not.toContainText('测试通过')
    await expect(sheet().getByRole('list', { name: '冲突的文件' })).toContainText('README.md两边都改了同一处')
    await expect(sheet().getByRole('radio', { name: 'Squash' })).toHaveCount(0)

    const handOff = sheet().getByRole('button', { name: /^交给 Claude 解决/ })
    await expect(handOff).toBeVisible()
    await expect(sheet()).toContainText('说明会放进 Claude 的输入行，看过后按回车发送')
    await shoot('05c-conflict')
    await page.keyboard.press('Meta+Enter')
    await expect(sheet()).toHaveCount(0)
    // Put into the input line, not sent: the text arrives without an Enter after it until the user presses one.
    await expect.poll(logged, WITHIN).toContain('完成后告诉我。')
    await page.waitForTimeout(500)
    expect(typed().endsWith('完成后告诉我。')).toBe(true)
    expect(logged()).toContain('GIT_EDITOR=true git merge main')
    await page.keyboard.press('Enter')
    await expect.poll(typed, WITHIN).toMatch(/完成后告诉我。<ENTER>\n$/)
    expect(repo.git(repo.project, 'rev-parse', 'main').trim()).toBe(before)
  })
})
