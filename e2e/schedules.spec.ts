// 定时任务 end to end (PRD F24, Figma 67′). A real git project with one Claude session (e2e/fake-hook-claude.ts: its hooks
// travel the real path). ⇧⌘T opens the dialog (empty state); a task made in the sheet — 开新会话, Claude Code, CLI,
// 接受编辑 — is run with 立即运行: a new worktree session appears as 「定时 · 分支」 and its claude got the message after
// `--` and `--permission-mode acceptEdits` on its command line; its run shows in the row's history. A 发给已有会话 task
// types its message into the idle session (the send protocol). A Stop hook with `session_crons` shows Claude's /loop
// mark. Screenshots in both themes go to test-results/schedules/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { alive, fakeHookClaude } from './fake-hook-claude'
import { launchApp, setWindowSize } from './launch'

const WITHIN = { timeout: 20_000 }
const SHOTS = join(process.cwd(), 'test-results', 'schedules')
const ID = 's-chat'

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

test.describe('定时任务', () => {
  const fake = fakeHookClaude('tr-e2e-schedules-')
  const agent = fake.folder('demo')
  const home = join(fake.root, 'home')
  const profile = join(fake.root, 'profile')
  const claudeConfig = join(fake.root, 'claude-config')
  const worktreesDir = join(home, '.tr', 'worktrees', 'demo')
  let app: ElectronApplication
  let page: Page

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  const dialog = () => page.getByTestId('schedules-dialog')
  const sheet = () => page.getByTestId('schedule-sheet')
  const sidebar = () => page.locator('[data-region="sidebar"]')
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
      await page.waitForTimeout(250)
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) })
    }
    await setTheme('dark')
  }
  /** The argv the fake claude of the scheduled run's worktree was started with. */
  const runArgv = (): string[] | null => {
    if (!existsSync(worktreesDir)) return null
    for (const folder of readdirSync(worktreesDir)) {
      const file = join(worktreesDir, folder, '.fake-argv')
      if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as string[]
    }
    return null
  }
  // eslint-disable-next-line no-control-regex
  const typed = () => agent.typed().replace(/\x1b\[20[01]~/g, '')

  test.beforeAll(async () => {
    mkdirSync(home, { recursive: true })
    mkdirSync(claudeConfig, { recursive: true })
    mkdirSync(profile, { recursive: true })
    git(agent.path, 'init', '-q', '-b', 'main')
    writeFileSync(join(agent.path, '.gitignore'), '.fake-*\n')
    writeFileSync(join(agent.path, 'README.md'), '# demo\n')
    git(agent.path, 'add', '.')
    git(agent.path, 'commit', '-q', '-m', 'init')
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p-demo', name: 'demo', rootPath: agent.path }],
        worktrees: [{ id: 'w-main', projectId: 'p-demo', branch: 'main', path: agent.path, isMain: true }],
        sessions: [{ id: ID, worktreeId: 'w-main', kind: 'claude', title: 'Cookie 会话迁移', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: ID,
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
    app = await launchApp({ ...fake.env, HOME: home, CLAUDE_CONFIG_DIR: claudeConfig }, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(sidebar().locator(`[data-session-id="${ID}"]`)).toBeVisible(WITHIN)
    await sidebar().locator(`[data-session-id="${ID}"]`).click()
    await expect.poll(agent.pid, WITHIN).not.toBeNull()
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    if (alive(agent.pid())) process.kill(agent.pid() as number, 'SIGTERM')
  })

  test('the app menu has 定时任务… ⇧⌘T; the sidebar row opens the dialog; with no task it offers 新建定时任务', async () => {
    // ⇧⌘T is the app menu's accelerator (native, so a synthetic key press does not reach it): the item is there.
    const item = await app.evaluate(({ Menu }) => {
      const found = Menu.getApplicationMenu()
        ?.items.flatMap((m) => m.submenu?.items ?? [])
        .find((i) => i.label === '定时任务…')
      return found ? { accelerator: found.accelerator ?? '' } : null
    })
    expect(item).toEqual({ accelerator: 'Shift+CmdOrCtrl+T' })
    await sidebar().getByRole('button', { name: /定时任务/ }).click()
    await expect(dialog()).toBeVisible(WITHIN)
    await expect(dialog()).toContainText('还没有定时任务')
    await shoot('empty')
  })

  test('a task made in the sheet shows in the list with its time and what it does', async () => {
    await dialog().getByRole('button', { name: '新建定时任务' }).click()
    await expect(sheet()).toBeVisible()
    await sheet().getByRole('textbox', { name: '名称' }).fill('每日依赖检查')
    await sheet().getByRole('radio', { name: 'CLI' }).click()
    await sheet().getByRole('radio', { name: '接受编辑' }).click()
    await sheet().getByRole('textbox', { name: '消息' }).fill('跑 npm audit，有高危的就升级')
    await expect(sheet()).toContainText('下次 ')
    await shoot('sheet')
    await sheet().getByRole('button', { name: /保存/ }).click()
    await expect(sheet()).toHaveCount(0)
    const row = dialog().getByTestId('schedule-row').filter({ hasText: '每日依赖检查' })
    await expect(row).toContainText('每天 09:00 · 在 demo 开 Claude Code')
    await expect(row).toContainText('下次')
    await expect(row).toContainText('还没运行过')
  })

  test('立即运行 opens a new worktree session marked 定时, with the message and the permission on its command line', async () => {
    const row = dialog().getByTestId('schedule-row').filter({ hasText: '每日依赖检查' })
    await row.getByRole('button', { name: '每日依赖检查：更多' }).click()
    await page.getByRole('menuitem', { name: '立即运行' }).click()
    await expect(row).toContainText('立即运行 · 开了「每日依赖检查', WITHIN)
    await expect(sidebar()).toContainText('定时 · ', WITHIN)
    await expect.poll(runArgv, WITHIN).not.toBeNull()
    const argv = runArgv() ?? []
    expect(argv).toEqual(expect.arrayContaining(['--permission-mode', 'acceptEdits', '--', '跑 npm audit，有高危的就升级']))
    await row.click()
    await expect(row).toContainText('打开')
    await shoot('list')
  })

  test('a 发给已有会话 task types its message into the idle session', async () => {
    const id = await page.evaluate(async (sessionId) => {
      const api = (globalThis as unknown as { tr: { schedules: { create(d: unknown): Promise<{ id: string } | null>; runNow(id: string): Promise<void> } } }).tr.schedules
      const made = await api.create({
        name: '催一下登录测试',
        enabled: true,
        action: { kind: 'send', sessionId },
        prompt: '登录测试跑完了没有',
        timing: { kind: 'interval', minutes: 30 },
        missed: 'catch-up'
      })
      if (made) await api.runNow(made.id)
      return made?.id ?? null
    }, ID)
    expect(id).not.toBeNull()
    await expect.poll(typed, WITHIN).toContain('登录测试跑完了没有<ENTER>')
    const row = dialog().getByTestId('schedule-row').filter({ hasText: '催一下登录测试' })
    await expect(row).toContainText('每隔 30 分钟 · 发给「Cookie 会话迁移」')
    await expect(row).toContainText('已发送', WITHIN)
  })

  test("Claude's own /loop shows as a mark in the session header, its timers on hover", async () => {
    await page.keyboard.press('Escape')
    await expect(dialog()).toHaveCount(0)
    agent.step({
      hook: 'Stop',
      payload: { last_assistant_message: '好的', session_crons: [{ id: 'c1', schedule: '*/10 * * * *', recurring: true, prompt: '看一下 CI 有没有过' }] }
    })
    const badge = page.getByTestId('loop-badge')
    await expect(badge).toContainText('每 10 分钟 · Claude 的 /loop', WITHIN)
    await badge.hover()
    await expect(badge.getByRole('tooltip')).toContainText('看一下 CI 有没有过')
    await shoot('loop')
  })
})
