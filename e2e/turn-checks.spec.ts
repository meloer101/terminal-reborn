// “这一轮跑过哪些检查” end to end (PRD F9 / F4). A fake `claude` (e2e/fake-hook-claude.ts) in a real worktree runs the
// per-launch hooks with the payloads Claude Code sends for Bash (PostToolUse = exit 0 with stdout, PostToolUseFailure =
// `Exit code N`, PRD §6.6), so the checks travel the real path (hook → socket → main's classification → renderer).
// Turn 1 runs the typecheck; turn 2 edits, passes the tests and fails lint, then says it is done. The overview's
// 待审阅 row and Git · 变更's facts row both say `测试 ✓ · lint ✗ · 类型 未跑`, and the merge stays possible.
// Screenshots in both themes go to test-results/turn-checks/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { alive, fakeHookClaude } from './fake-hook-claude'
import { launchApp, setWindowSize } from './launch'

const WITHIN = { timeout: 20_000 }
const SHOTS = join(process.cwd(), 'test-results', 'turn-checks')
const ID = 's-checks'

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

test.describe('turn checks', () => {
  const fake = fakeHookClaude('tr-e2e-checks-')
  const project = join(fake.root, 'demo')
  const worktree = join(fake.root, 'wt-login')
  const profile = join(fake.root, 'profile')
  const claudeConfig = join(fake.root, 'claude-config')
  let agent: ReturnType<typeof fake.folder>
  let app: ElectronApplication
  let page: Page

  const sidebarRow = (id: string) => page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`)
  const overview = () => page.locator('[data-region="overview"]')
  const setTheme = (theme: 'dark' | 'light') =>
    page.evaluate((t) => {
      ;(globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.theme = t
    }, theme)
  const shoot = async (name: string) => {
    mkdirSync(SHOTS, { recursive: true })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(theme)
      await page.waitForTimeout(150)
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) })
    }
    await setTheme('dark')
  }

  test.beforeAll(async () => {
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
    mkdirSync(project)
    writeFileSync(join(project, 'README.md'), '# demo\n')
    // The fake's own files stay out of the worktree's changes.
    writeFileSync(join(project, '.gitignore'), '.fake-*\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'add', '.')
    git(project, 'commit', '-q', '-m', 'init')
    git(project, 'worktree', 'add', '-q', '-b', 'jacob/login', worktree)
    git(project, 'config', 'branch.jacob/login.base', 'main')
    writeFileSync(join(worktree, 'login.ts'), 'export const login = 1\n')
    git(worktree, 'add', '.')
    git(worktree, 'commit', '-q', '-m', 'Login page')
    agent = fake.folder('wt-login')

    mkdirSync(profile, { recursive: true })
    mkdirSync(claudeConfig, { recursive: true })
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: project }],
        worktrees: [
          { id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true },
          { id: 'w-login', projectId: 'p1', branch: 'jacob/login', path: worktree, isMain: false, baseBranch: 'main' }
        ],
        sessions: [
          { id: ID, worktreeId: 'w-login', kind: 'claude', title: '登录页', startedAt: 1, lastActivityAt: 1 },
          { id: 's-shell', worktreeId: 'w-main', kind: 'shell', title: '终端', startedAt: 2, lastActivityAt: 2 }
        ],
        activeSessionId: ID,
        sidebarCollapsed: false,
        rightPanel: 'git',
        drafts: {}
      })
    )
    app = await launchApp({ ...fake.env, CLAUDE_CONFIG_DIR: claudeConfig }, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(sidebarRow(ID)).toBeVisible(WITHIN)
    await sidebarRow(ID).click()
    await expect.poll(() => agent.pid(), WITHIN).not.toBeNull()
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    if (alive(agent?.pid() ?? null)) process.kill(agent.pid() as number, 'SIGTERM')
  })

  test('the overview’s 待审阅 row says what ran this turn and how it came out', async () => {
    // Turn 1, watched: only a typecheck. It makes the typecheck a check this session runs.
    agent.step({ hook: 'UserPromptSubmit', payload: { prompt: '先看看类型' } })
    agent.step({ hook: 'PostToolUse', payload: { tool_name: 'Bash', tool_input: { command: 'npx tsc --noEmit' }, tool_response: { stdout: '', stderr: '', interrupted: false } } })
    agent.step({ hook: 'Stop', payload: { last_assistant_message: '类型没问题。' } })
    await expect(sidebarRow(ID).getByRole('img', { name: '空闲' })).toBeVisible(WITHIN)

    // Turn 2, while the user is elsewhere.
    await sidebarRow('s-shell').click()
    agent.step({ hook: 'UserPromptSubmit', payload: { prompt: '把登录页改成中文' } })
    agent.step({ hook: 'PostToolUse', payload: { tool_name: 'Edit', tool_input: { file_path: join(worktree, 'login.ts') }, tool_response: {} } })
    agent.step({
      hook: 'PostToolUse',
      payload: { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: ' Test Files  2 passed (2)\n      Tests  9 passed (9)\n', stderr: '' } }
    })
    agent.step({
      hook: 'PostToolUseFailure',
      payload: { tool_name: 'Bash', tool_input: { command: 'npm run lint' }, error: 'Exit code 1\n✖ 2 problems (2 errors, 0 warnings)', is_interrupt: false }
    })
    agent.step({ hook: 'Stop', payload: { last_assistant_message: '登录页改好了，测试都通过了。' } })
    await expect(sidebarRow(ID).getByRole('img', { name: '已完成' })).toBeVisible(WITHIN)

    await page.keyboard.press('Meta+Shift+A')
    await expect(overview()).toBeVisible()
    const row = overview().locator('section[aria-label="待审阅"]').locator(`[data-session-id="${ID}"]`)
    const tag = row.getByTestId('turn-checks')
    await expect(tag).toHaveAccessibleName('这一轮：测试通过，lint 没过，类型检查没跑', WITHIN)
    await expect(tag).toHaveText(/测试.*·.*lint.*·.*类型.*未跑/)
    await expect(tag.locator('[data-kind="test"]')).toHaveAttribute('data-status', 'pass')
    await expect(tag.locator('[data-kind="lint"]')).toHaveAttribute('data-status', 'fail')
    await expect(tag.locator('[data-kind="typecheck"]')).toHaveAttribute('data-status', 'not-run')
    expect(await tag.getAttribute('title')).toContain('✗ npm run lint')
    await shoot('overview-review-row')
    // Only 待审阅 rows carry it: the shell has none.
    await expect(overview().getByTestId('turn-checks')).toHaveCount(1)
  })

  test('Git · 变更 says the same checks in its facts row, and the exit stays open', async () => {
    await page.keyboard.press('Escape')
    await expect(overview()).toBeHidden()
    await sidebarRow(ID).click()
    const panel = page.locator('[data-region="panel"]')
    await panel.getByRole('tab', { name: /^变更/ }).click()
    await expect(panel.getByTestId('facts')).toContainText('这一轮跑过：测试 ✓ · lint ✗ · 类型 未跑', WITHIN)
    // Information only: the agent's own checks never block 合并.
    await expect(panel.getByRole('button', { name: /^合并到 main( |$)/ })).toBeEnabled(WITHIN)
    await shoot('facts-row')
  })

  test('a turn that only talks keeps showing the last one, as 上一轮', async () => {
    await sidebarRow('s-shell').click()
    agent.step({ hook: 'UserPromptSubmit', payload: { prompt: '改了哪些文件？' } })
    agent.step({ hook: 'Stop', payload: { last_assistant_message: '只改了 login.ts。' } })
    await expect(sidebarRow(ID).getByRole('img', { name: '已完成' })).toBeVisible(WITHIN)
    await page.keyboard.press('Meta+Shift+A')
    const tag = overview().locator(`[data-session-id="${ID}"]`).getByTestId('turn-checks')
    await expect(tag).toHaveAccessibleName('上一轮：测试通过，lint 没过，类型检查没跑', WITHIN)
    await expect(tag).toContainText('上一轮')
    await page.keyboard.press('Escape')
  })
})
