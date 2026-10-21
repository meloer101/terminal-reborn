// F16 PR / CI status and 创建 PR with a fake `gh` and a fake `claude` on the login shell's PATH. origin's fetch URL
// says github.com/acme/widget; its push URL is a local bare repository, so pushes are real. Worktrees:
//   jacob/nav  — never pushed: no tag; 创建 PR asks, pushes and creates #7 (checks passing)
//   jacob/ci   — #12 open, `test` failing: ✗, and 让 agent 修复 puts the failure into the agent's input line
//   jacob/wip  — #13 draft, checks running
//   jacob/done — #9 merged
// github.com resolves to this machine, so opening a PR page never leaves it. Screenshots in both themes go to
// test-results/pull-requests/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeClaude } from './fake-claude'
import { fakeGh } from './fake-gh'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'pull-requests')
const WITHIN = { timeout: 30_000 }
const BRANCHES = ['jacob/nav', 'jacob/ci', 'jacob/wip', 'jacob/done'] as const

function setup() {
  const fake = fakeClaude('tr-e2e-pr-')
  const gh = fakeGh(join(fake.root, 'bin'), join(fake.root, 'gh'))
  const project = join(fake.root, 'demo')
  const bare = join(fake.root, 'origin.git')
  mkdirSync(project)
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  const commitIn = (cwd: string, file: string, text: string, message: string) => {
    writeFileSync(join(cwd, file), text)
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', message)
  }
  git(fake.root, 'init', '-q', '--bare', '-b', 'main', bare)
  writeFileSync(join(project, 'README.md'), '# demo\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'add', '.')
  git(project, 'commit', '-q', '-m', 'init')
  git(project, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git')
  git(project, 'config', 'remote.origin.pushurl', bare)
  git(project, 'push', '-q', '-u', 'origin', 'main')
  const paths: Record<string, string> = {}
  for (const branch of BRANCHES) {
    const path = join(fake.root, `wt-${branch.split('/')[1]}`)
    paths[branch] = path
    git(project, 'worktree', 'add', '-q', '-b', branch, path)
    git(project, 'config', `branch.${branch}.base`, 'main')
    commitIn(path, `${branch.split('/')[1]}.ts`, 'export {}\n', `Add ${branch}`)
    if (branch !== 'jacob/nav') git(path, 'push', '-q', '-u', 'origin', branch)
  }
  commitIn(paths['jacob/nav']!, 'nav.test.ts', 'test("nav")\n', 'Test nav')

  gh.setPrs('jacob/ci', [
    {
      number: 12,
      state: 'OPEN',
      checks: [
        { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', job: 41 },
        { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', job: 42 }
      ]
    }
  ])
  gh.setPrs('jacob/wip', [{ number: 13, state: 'OPEN', isDraft: true, checks: [{ name: 'test', status: 'IN_PROGRESS', conclusion: null }] }])
  gh.setPrs('jacob/done', [{ number: 9, state: 'MERGED', checks: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] }])
  gh.afterCreate('jacob/nav', [{ number: 7, state: 'OPEN', checks: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] }], 'https://github.com/acme/widget/pull/7')
  gh.setFailedLog(
    [
      'test\tRun npm test\t2026-10-20T17:15:15.9535000Z \u001b[31mFAIL\u001b[0m src/nav.test.ts',
      'test\tRun npm test\t2026-10-20T17:15:15.9537000Z   expected 1 to be 2',
      'test\tRun npm test\t2026-10-20T17:15:15.9713790Z ##[error]Process completed with exit code 1.'
    ].join('\n')
  )
  return { ...fake, gh, project, bare, paths, git, env: { ...fake.env, ...gh.env } }
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('F16 PR / CI status', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-pr-profile-'))
  const repo = setup()
  let app: ElectronApplication
  let page: Page

  const panel = () => page.locator('[data-region="panel"]')
  const row = (id: string) => page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`)
  const tag = (id: string) => row(id).getByTestId('pr-tag')
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
    const worktree = (id: string, branch: string) => ({ id, projectId: 'p1', branch, path: repo.paths[branch], isMain: false, baseBranch: 'main' })
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: repo.project }],
        worktrees: [
          { id: 'w-main', projectId: 'p1', branch: 'main', path: repo.project, isMain: true },
          worktree('w-nav', 'jacob/nav'),
          worktree('w-ci', 'jacob/ci'),
          worktree('w-wip', 'jacob/wip'),
          worktree('w-done', 'jacob/done')
        ],
        sessions: [
          { id: 's-nav', worktreeId: 'w-nav', kind: 'claude', title: '导航吸顶', startedAt: 1, lastActivityAt: 1 },
          { id: 's-ci', worktreeId: 'w-ci', kind: 'claude', title: '修 CI', startedAt: 2, lastActivityAt: 2 },
          { id: 's-wip', worktreeId: 'w-wip', kind: 'claude', title: '草稿', startedAt: 3, lastActivityAt: 3 },
          { id: 's-done', worktreeId: 'w-done', kind: 'claude', title: '已合并的', startedAt: 4, lastActivityAt: 4 }
        ],
        activeSessionId: 's-nav',
        sidebarCollapsed: false,
        rightPanel: 'git',
        drafts: {}
      })
    )
    app = await launchApp(repo.env, { userDataDir: profile, args: ['--host-resolver-rules=MAP github.com 127.0.0.1'] })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('sidebar rows show #N with the PR state and a checks mark that is not color alone', async () => {
    await expect(tag('s-ci')).toHaveText('#12', WITHIN)
    await expect(tag('s-ci')).toHaveAttribute('data-checks', 'failing')
    await expect(tag('s-ci')).toHaveAttribute('title', 'PR #12 · 已打开 · 1 项检查失败：test')
    await expect(tag('s-wip')).toHaveText('#13草稿', WITHIN)
    await expect(tag('s-wip')).toHaveAttribute('data-checks', 'pending')
    await expect(tag('s-wip')).toHaveAttribute('title', 'PR #13 · 草稿 · 检查进行中 0/1')
    await expect(tag('s-done')).toHaveText('#9已合并', WITHIN)
    await expect(tag('s-done')).not.toHaveAttribute('data-checks')
    // Never pushed: gh is not asked about it.
    await expect(tag('s-nav')).toHaveCount(0)
    expect(repo.gh.calls().some((call) => call.includes('--head=jacob/nav'))).toBe(false)
    await shoot('sidebar')
  })

  test('the overview list has a PR column, blank for a branch without one', async () => {
    await page.keyboard.press('Meta+Shift+A')
    const overview = page.locator('[data-region="overview"]')
    await expect(overview.locator('[data-session-id="s-ci"] [data-testid="overview-pr"]')).toHaveText('#12', WITHIN)
    await expect(overview.locator('[data-session-id="s-done"] [data-testid="overview-pr"]')).toHaveText('#9已合并')
    await expect(overview.locator('[data-session-id="s-nav"] [data-testid="overview-pr"]')).toHaveText('')
    await shoot('overview')
    await page.keyboard.press('Escape')
    await expect(overview).toHaveCount(0)
  })

  test('创建 PR asks before the first push, pushes, creates the PR and opens it in the built-in browser', async () => {
    await row('s-nav').click()
    await panel().getByRole('tab', { name: /^变更/ }).click()
    const create = panel().getByRole('button', { name: '创建 PR' })
    await expect(create).toBeEnabled(WITHIN)
    await create.click()
    await expect(panel().getByRole('textbox', { name: '地址' })).toHaveValue('https://github.com/acme/widget/pull/7', WITHIN)
    const dialogs = await app.evaluate(() => (globalThis as unknown as { __trDialogs: { requests: { message: string }[] } }).__trDialogs.requests.map((r) => r.message))
    expect(dialogs).toContain('把分支 jacob/nav 推送到 origin？')
    expect(repo.git(repo.bare, 'rev-parse', 'refs/heads/jacob/nav').trim()).toBe(repo.git(repo.paths['jacob/nav']!, 'rev-parse', 'HEAD').trim())
    const call = repo.gh.calls().find((c) => c[0] === 'pr' && c[1] === 'create')!
    expect(call).toEqual(expect.arrayContaining(['--repo=github.com/acme/widget', '--head=jacob/nav', '--base=main', '--title=导航吸顶']))
    expect(call.join('\n')).toContain('--body=- Add jacob/nav\n- Test nav')
    // The new PR shows at once, checks passing.
    await expect(tag('s-nav')).toHaveText('#7', WITHIN)
    await expect(tag('s-nav')).toHaveAttribute('data-checks', 'passing')
  })

  test('the footer opens the existing PR, and a failing PR hands its log to the agent without pressing Enter', async () => {
    await row('s-ci').click()
    // Opening the PR switched the right panel to the browser.
    await page.locator('header').getByRole('group', { name: '右侧栏' }).getByRole('button', { name: 'Git' }).click()
    await panel().getByRole('tab', { name: /^变更/ }).click()
    const status = panel().getByTestId('pr-status')
    await expect(status).toContainText('PR #12 · 已打开 · 1 项检查失败：test', WITHIN)
    await expect(panel().getByRole('button', { name: '打开 PR #12' })).toBeVisible()
    await shoot('changes-failing')
    await status.getByRole('button', { name: '让 agent 修复' }).click()
    await expect.poll(repo.typed, WITHIN).toContain('PR #12 的 CI 没通过：test。请查明原因并修复。')
    await expect.poll(repo.typed, WITHIN).toContain('> FAIL src/nav.test.ts ⏎ expected 1 to be 2 ⏎ ##[error]Process completed with exit code 1.')
    expect(repo.gh.calls().find((c) => c[0] === 'run')).toEqual(['run', 'view', '--repo=github.com/acme/widget', '--job=41', '--log-failed'])
    // In the input line, not sent: nothing after it until the user presses Enter.
    await page.waitForTimeout(500)
    expect(repo.typed().endsWith('exit code 1.')).toBe(true)
    expect(repo.typed()).not.toContain('<ENTER>')
  })
})

test.describe('F16 without gh', () => {
  test('shows no PR tags and a one-line hint where 创建 PR is', async () => {
    const fake = fakeClaude('tr-e2e-pr-nogh-')
    const project = join(fake.root, 'demo')
    mkdirSync(project)
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd: project })
    writeFileSync(join(project, 'README.md'), '# demo\n')
    git('init', '-q', '-b', 'main')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    const wt = join(fake.root, 'wt')
    git('worktree', 'add', '-q', '-b', 'jacob/x', wt)
    const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-pr-nogh-profile-'))
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: project }],
        worktrees: [
          { id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true },
          { id: 'w-x', projectId: 'p1', branch: 'jacob/x', path: wt, isMain: false, baseBranch: 'main' }
        ],
        sessions: [{ id: 's-x', worktreeId: 'w-x', kind: 'claude', title: 'x', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's-x',
        sidebarCollapsed: false,
        rightPanel: 'git',
        drafts: {}
      })
    )
    // launchApp's default TR_GH=off: as if gh were not installed.
    const app = await launchApp(fake.env, { userDataDir: profile })
    try {
      const page = await app.firstWindow()
      await setWindowSize(app, page, 1440, 900)
      const panel = page.locator('[data-region="panel"]')
      await panel.getByRole('tab', { name: /^变更/ }).click()
      await expect(panel.getByTestId('pr-status')).toHaveText('创建 PR 需要 GitHub CLI：装好 gh 后在终端运行 gh auth login', WITHIN)
      const create = panel.getByRole('button', { name: '创建 PR' })
      await expect(create).toBeDisabled()
      await expect(page.getByTestId('pr-tag')).toHaveCount(0)
    } finally {
      await app.close().catch(() => {})
    }
  })
})
