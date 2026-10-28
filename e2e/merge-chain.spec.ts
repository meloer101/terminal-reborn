// F13 review block and F16 exit A (合并到 main) on a repository without a remote, with the fake hook agent
// (e2e/fake-hook-claude.ts; also answers Wavi's background `claude -p` review). Worktrees: jacob/clean (three files, two
// commits and a package.json change; merges cleanly) and jacob/conflict (edits the README that main also edited).
// Checks the review block (header, counts, summary, one row per finding, the P1 tag on the diff line, 发给 putting the
// ticked findings into the input line without Enter), the facts row for a risk marker, the agent-command review mode,
// a squash merge landing on main from the agent-written message, and a conflict that is put into the agent's input
// line (sent only when the user presses Enter) with main untouched.
// Screenshots in both themes go to test-results/merge-chain/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeHookClaude } from './fake-hook-claude'
import { launchApp, setWindowSize } from './launch'
import { agentWrites, promptedPath, typedBy } from './ship'

const SHOTS = join(process.cwd(), 'test-results', 'merge-chain')
const WITHIN = { timeout: 30_000 }

function setup() {
  const fake = fakeHookClaude('tr-e2e-chain-')
  const project = join(fake.root, 'demo')
  const clean = join(fake.root, 'wt-clean')
  const conflict = join(fake.root, 'wt-conflict')
  mkdirSync(project)
  mkdirSync(join(fake.root, 'claude-config'))

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  const commitIn = (cwd: string, file: string, text: string, message: string) => {
    writeFileSync(join(cwd, file), text)
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', message)
  }
  writeFileSync(join(project, 'README.md'), '# demo\n')
  // The fake agent's own files stay out of the worktrees' changes.
  writeFileSync(join(project, '.gitignore'), '.fake-*\n')
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
  commitIn(clean, 'package.json', '{ "name": "demo", "dependencies": { "left-pad": "1.3.0" } }\n', 'Add a dependency')
  commitIn(conflict, 'README.md', '# demo\nfrom the branch\n', 'Branch edits README')
  commitIn(project, 'README.md', '# demo\nfrom main\n', 'Main edits README')
  return {
    ...fake,
    project,
    clean,
    conflict,
    git,
    agents: { clean: fake.folder('wt-clean'), conflict: fake.folder('wt-conflict') }
  }
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('F13 review block · F16 exit A', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-chain-profile-'))
  const repo = setup()
  let app: ElectronApplication
  let page: Page

  const panel = () => page.locator('[data-region="panel"]')
  const block = () => panel().getByTestId('review-block')
  const ship = () => panel().getByTestId('ship-block')
  const cleanTyped = () => typedBy(repo.agents.clean)
  const conflictTyped = () => typedBy(repo.agents.conflict)
  const screen = () =>
    page.evaluate(
      (id) => (globalThis as unknown as { __trTerminals?: { readScreen(id: string, scrollbackLines?: number): string } }).__trTerminals?.readScreen(id, 50) ?? '',
      's-conflict'
    )
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
    app = await launchApp({ ...repo.env, CLAUDE_CONFIG_DIR: join(repo.root, 'claude-config') }, { userDataDir: profile })
    page = await app.firstWindow()
    // Reading the screen (to know when a printed menu is there) is opt-in, and set before the page's scripts run.
    await page.addInitScript(() => {
      ;(globalThis as unknown as { __TR_TERMINAL_PROBE__: boolean }).__TR_TERMINAL_PROBE__ = true
    })
    await page.reload()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => repo.agents.clean.pid(), WITHIN).not.toBeNull()
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  const updateSettings = (patch: unknown) =>
    page.evaluate((p) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update(p), patch)

  test('the facts row names a risk marker read off the diff: 改了依赖', async () => {
    await panel().getByRole('tab', { name: /^变更/ }).click()
    const facts = panel().getByTestId('facts')
    await expect(facts).toContainText('改了依赖 · package.json', WITHIN)
    await shoot('facts')
  })

  test('F13: 审阅全部改动 runs a background review; the block lists the findings, the diff line wears a P1 tag, 发给 puts the ticked ones into the input line', async () => {
    const finding = { path: 'nav.ts', startLine: 1, endLine: 1, side: 'new', group: 'committed', confidence: 0.9 }
    repo.reviewReply({
      summary: '两处',
      findings: [
        { ...finding, severity: 'P1', title: 'sticky 会挡住锚点', explanation: '滚动到锚点时标题被导航盖住' },
        { ...finding, severity: 'P3', title: '可以用常量', explanation: "把 'sticky' 提成常量" }
      ]
    })
    const review = panel().getByRole('button', { name: '审阅全部改动' })
    await expect(review).toBeEnabled(WITHIN)
    await review.click()

    await expect(block()).toContainText('Claude 审阅 · 3 个文件', WITHIN)
    await expect(block()).toContainText('两处')
    const rows = block().getByRole('list', { name: '审阅发现' }).getByRole('listitem')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('P1')
    await expect(rows.nth(0)).toContainText('nav.ts:1')
    await expect(rows.nth(0)).toContainText('sticky 会挡住锚点')
    await expect(rows.nth(1)).toContainText('P3')
    // P1 starts ticked, P3 unticked; the button counts the ticked ones.
    await expect(rows.nth(0).getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
    await expect(rows.nth(1).getByRole('checkbox')).toHaveAttribute('aria-checked', 'false')
    await expect(block().getByRole('button', { name: '发给 Claude · 1' })).toBeEnabled()
    await shoot('review-block')
    // A read-only reviewer got the diff on stdin; nothing went into the coding session.
    expect(repo.reviewPrompt()).toContain("+export const nav = 'sticky'")
    expect(repo.reviewPrompt()).toContain('# wavi-group: committed')
    expect(cleanTyped()).not.toContain('code-review')

    // The finding's line in the diff wears its tag; clicking it points at the finding in the block.
    await panel().locator('[data-path="nav.ts"][data-group="committed"] button').first().click()
    const line = panel().locator('[data-owner="committed:nav.ts"][data-line="1"]')
    const tag = line.getByRole('button', { name: /^审阅 P1、P3/ })
    await expect(tag).toHaveText('P1')
    await tag.click()
    await expect(rows.nth(0)).toHaveAttribute('data-flash', 'true')
    await shoot('review-diff-tag')

    await block().getByRole('button', { name: '发给 Claude · 1' }).click()
    await expect.poll(cleanTyped, WITHIN).toContain('P1 nav.ts:1')
    expect(cleanTyped()).not.toContain('可以用常量')
    // Put into the input line, not sent: Enter is the user's.
    await page.waitForTimeout(500)
    expect(cleanTyped().endsWith('改完后告诉我改了什么。')).toBe(true)
    // The sent finding leaves the list; the unticked P3 stays for later.
    await expect(rows).toHaveCount(1)
    await expect(rows.nth(0)).toContainText('P3')
    await expect(line.getByRole('button', { name: /^审阅 P3/ })).toBeVisible()
    await expect(line.getByRole('button', { name: /^审阅 P1/ })).toHaveCount(0)
  })

  test('F13: 审阅方式 · agent 自带命令 types /code-review into the session', async () => {
    // Review findings stay in the review block: the footer keeps the review button, never 发给 / 放弃 for them.
    await expect(block().getByRole('listitem')).toHaveCount(1)
    await expect(panel().getByRole('button', { name: '放弃' })).toHaveCount(0)
    await updateSettings({ review: { mode: 'agent-command' } })
    const review = panel().getByRole('button', { name: '让 agent 审阅' })
    await expect(review).toHaveAttribute('title', '在终端里发送 /code-review', WITHIN)
    await review.click()
    await expect.poll(cleanTyped, WITHIN).toMatch(/\/code-review.*<ENTER>/s)
    await updateSettings({ review: { mode: 'builtin' } })
  })

  test('exit A without a remote: 合并到 main is the only exit; the agent writes commit.md, ⌘↵ squashes the branch into main', async () => {
    await expect(panel().getByRole('button', { name: /^创建 PR/ })).toHaveCount(0)
    const exit = panel().getByRole('button', { name: /^合并到 main( |$)/ })
    await expect(exit).toBeEnabled(WITHIN)
    await exit.click()
    await expect(ship()).toHaveAttribute('data-stage', 'writing')
    await expect(ship()).toContainText('Claude Code 写提交说明')
    const file = await promptedPath(repo.agents.clean, 'wt-clean', 'commit')
    agentWrites(repo.agents.clean, file, '导航吸顶\n\n- 导航滚动时吸在顶部\n- 加了测试\n')

    await expect(ship()).toHaveAttribute('data-stage', 'glance', WITHIN)
    await expect(ship().getByRole('textbox', { name: '提交说明' })).toHaveValue('导航吸顶\n\n- 导航滚动时吸在顶部\n- 加了测试')
    await shoot('ship-glance')
    await page.keyboard.press('Meta+Enter')

    await expect(ship()).toHaveCount(0, WITHIN)
    await expect(panel().getByTestId('pr-status')).toContainText(/已合并到 main · [0-9a-f]{7}/)
    expect(repo.git(repo.project, 'log', '-1', '--format=%B', 'main').trim()).toBe('导航吸顶\n\n- 导航滚动时吸在顶部\n- 加了测试')
    expect(existsSync(join(repo.project, 'nav.ts'))).toBe(true)
    // The branch and its worktree stay: archiving them is the user's call.
    expect(existsSync(repo.clean)).toBe(true)
    expect(repo.git(repo.project, 'branch', '--list', 'jacob/clean').trim()).toContain('jacob/clean')
  })

  test('exit A on a conflicting branch: the files go into the agent’s input line, not sent; main does not move', async () => {
    await page.locator(`[data-region="sidebar"] [data-session-id="s-conflict"]`).click()
    await expect(page.locator('header h1')).toHaveText('改 README')
    await expect.poll(() => repo.agents.conflict.pid(), WITHIN).not.toBeNull()
    const before = repo.git(repo.project, 'rev-parse', 'main').trim()
    await panel().getByRole('tab', { name: /^变更/ }).click()
    await panel().getByRole('button', { name: /^合并到 main( |$)/ }).click()
    const file = await promptedPath(repo.agents.conflict, 'wt-conflict', 'commit')
    agentWrites(repo.agents.conflict, file, 'docs: 改 README\n')
    await expect(ship()).toHaveAttribute('data-stage', 'glance', WITHIN)
    await page.keyboard.press('Meta+Enter')

    const alert = ship().getByRole('alert')
    await expect(alert).toContainText('1 个文件和 main 冲突', WITHIN)
    await expect(ship().locator('[data-step="merge"]')).toHaveAttribute('data-state', 'failed')
    const handOff = ship().getByRole('button', { name: '交给 Claude Code 解' })
    await expect(handOff).toBeVisible()
    await shoot('ship-conflict')

    // A menu is open over the agent's input line (Claude's /rate-limit-options): nothing is typed, the block stays and
    // says why (PRD §6.7, §6.9). Once the menu is gone the same button hands the text over.
    repo.agents.conflict.step({
      print:
        '\r\n What do you want to do?\r\n ❯ 1. Wait here, then continue automatically at 5:22pm\r\n   2. Stop and wait for limit to reset\r\n\r\n Enter to confirm · Esc to cancel\r\n'
    })
    await expect.poll(screen, WITHIN).toContain('What do you want to do?')
    const untouched = conflictTyped()
    await handOff.click()
    await expect(ship().getByRole('alert')).toContainText('终端里有选择框，请先在终端中处理')
    await page.waitForTimeout(500)
    expect(conflictTyped()).toBe(untouched)
    await shoot('ship-conflict-refused')
    repo.agents.conflict.step({ print: '\x1b[2J\x1b[H❯ ' })
    await expect.poll(screen, WITHIN).not.toContain('What do you want to do?')

    await ship().getByRole('button', { name: '交给 Claude Code 解' }).click()
    await expect(ship()).toHaveCount(0)
    // Put into the input line, not sent: the text arrives without an Enter after it until the user presses one.
    await expect.poll(conflictTyped, WITHIN).toContain('合并到 main 时这些文件有冲突，请解决后提交：')
    await page.waitForTimeout(500)
    expect(conflictTyped().endsWith('- README.md')).toBe(true)
    await page.keyboard.press('Enter')
    await expect.poll(conflictTyped, WITHIN).toMatch(/- README\.md<ENTER>\n$/)
    expect(repo.git(repo.project, 'rev-parse', 'main').trim()).toBe(before)
  })
})
