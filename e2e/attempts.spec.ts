// 一题多解 + 广播 end to end (PRD F4 / F9 / F15 v1.59) on a real repository. Fake agents: two `claude` that run the
// per-launch hooks (e2e/fake-hook-claude.ts) and a `codex` that only draws its UI; each logs what was typed into it
// to `.fake-typed` in the folder it runs in. ⌘N · 智能体 · 多个 with Claude Code ×2 · Codex ×1 makes three worktrees off
// main and sends the task to each exactly once; the overview compares them (diff, checks, compare bar); ⌘-picked rows
// get one message only after the confirmation; 停止 sends Esc; merging one offers to archive the other two, which
// happens only after its confirmation. Screenshots in both themes go to test-results/attempts/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeHookClaude } from './fake-hook-claude'
import { launchApp, setWindowSize } from './launch'

const WITHIN = { timeout: 30_000 }
const SHOTS = join(process.cwd(), 'test-results', 'attempts')
const TASK = '把登录页改成两步'
const BROADCAST = '先别改 API，只改界面'

// Draws a Codex-like screen (Wavi reads `OpenAI Codex` as its UI) and echoes and logs every byte typed.
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require('node:fs')
const dir = process.cwd()
fs.writeFileSync(dir + '/.fake-pid', String(process.pid))
process.stdout.write('OpenAI Codex (fake)\\r\\n\\r\\n› ')
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.on('data', (d) => {
  const text = d.toString()
  fs.appendFileSync(dir + '/.fake-typed', text.replace(/\\r/g, '<ENTER>\\n'))
  process.stdout.write(text.replace(/\\x1b\\[20[01]~/g, '').replace(/\\r/g, '\\r\\n› '))
})
`

type Dialogs = { requests: Array<{ message: string; detail?: string; confirmLabel: string }>; answer: boolean }

test.describe.configure({ mode: 'serial' })
test.setTimeout(150_000)

test.describe('一题多解 + 广播', () => {
  const fake = fakeHookClaude('tr-e2e-attempts-')
  const home = join(fake.root, 'home')
  const project = join(fake.root, 'demo')
  const profile = join(fake.root, 'profile')
  const worktreesDir = join(home, '.tr', 'worktrees', 'demo')
  let app: ElectronApplication
  let page: Page
  /** The three members' folders, in launch order (Claude Code 1, Claude Code 2, Codex). */
  let folders: string[] = []

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  // What reached the agent's input, without the bracketed-paste markers the send protocol wraps text in (PRD §6.9).
  const typed = (dir: string) =>
    existsSync(join(dir, '.fake-typed')) ? readFileSync(join(dir, '.fake-typed'), 'utf8').replaceAll('\u001b[200~', '').replaceAll('\u001b[201~', '') : ''
  const step = (dir: string, value: unknown) => appendFileSync(join(dir, '.fake-steps'), `${JSON.stringify(value)}\n`)
  const count = (haystack: string, needle: string) => haystack.split(needle).length - 1
  const overview = () => page.locator('[data-region="overview"]')
  const overlay = () => page.locator('[data-region="overview-overlay"]')
  const sheet = () => page.getByTestId('new-session-sheet')
  const sidebar = () => page.locator('[data-region="sidebar"]')
  const dialogs = () => app.evaluate(() => (globalThis as unknown as { __trDialogs: Dialogs }).__trDialogs.requests)
  const answerDialogs = (answer: boolean) =>
    app.evaluate((_e, a) => {
      ;(globalThis as unknown as { __trDialogs: Dialogs }).__trDialogs.answer = a
    }, answer)
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
  /** The member session ids, read from the overview's compare bars in launch order. */
  const memberIds = () => overlay().getByTestId('attempt-compare').evaluateAll((els) => els.map((el) => (el as unknown as { dataset: { memberId: string } }).dataset.memberId))

  test.beforeAll(async () => {
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, '.zshrc'), '')
    writeFileSync(join(fake.root, 'bin', 'codex'), FAKE_CODEX)
    chmodSync(join(fake.root, 'bin', 'codex'), 0o755)
    mkdirSync(project)
    writeFileSync(join(project, 'README.md'), '# demo\n')
    // The fakes' own files stay out of every worktree's changes.
    writeFileSync(join(project, '.gitignore'), '.fake-*\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.name', 'Jacob E2E')
    git(project, 'config', 'user.email', 'e2e@example.com')
    git(project, 'add', '.')
    git(project, 'commit', '-q', '-m', 'init')
    mkdirSync(profile, { recursive: true })
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'demo', rootPath: project }],
        worktrees: [{ id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true }],
        sessions: [{ id: 's-shell', worktreeId: 'w-main', kind: 'shell', title: '终端', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's-shell',
        sidebarCollapsed: false,
        drafts: {}
      })
    )
    app = await launchApp({ ...fake.env, HOME: home, CLAUDE_CONFIG_DIR: join(fake.root, 'claude-config') }, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible(WITHIN)
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    for (const dir of folders) {
      const pid = existsSync(join(dir, '.fake-pid')) ? Number(readFileSync(join(dir, '.fake-pid'), 'utf8')) : 0
      try {
        if (pid) process.kill(pid, 'SIGTERM')
      } catch {
        // Already gone.
      }
    }
  })

  test('智能体 · 多个 asks for 份数 and one task, and the button says what it sends to whom', async () => {
    await page.keyboard.press('Meta+N')
    await expect(sheet()).toBeVisible()
    await sheet().getByRole('button', { name: '智能体' }).click()
    await page.getByRole('listbox', { name: '智能体' }).getByRole('option', { name: /多个智能体一起做/ }).click()
    await expect(sheet().getByRole('group', { name: 'Claude Code 份数' })).toContainText('2', WITHIN)
    // Codex is on the PATH, so the default compares it with Claude.
    await expect(sheet().getByRole('group', { name: 'Codex 份数' })).toContainText('1', WITHIN)
    const create = sheet().getByRole('button', { name: /^创建 3 个并发送/ })
    await expect(create).toBeDisabled()
    // 当前目录 cannot hold several attempts.
    await expect(sheet().getByRole('radio', { name: '当前目录' })).toBeDisabled()
    await sheet().getByRole('textbox', { name: '任务' }).fill(TASK)
    await expect(create).toBeEnabled()
    await expect(sheet()).toContainText('新建 3 个 worktree（基于 main），各启动一个 agent，把这段话发给每一个并按回车：Claude Code ×2 · Codex ×1。')
    // One more Claude, then back: the label follows.
    await sheet().getByRole('button', { name: 'Claude Code 多一份' }).click()
    await expect(sheet().getByRole('button', { name: /^创建 4 个并发送/ })).toBeVisible()
    await expect(sheet().getByRole('button', { name: 'Codex 多一份' })).toBeEnabled()
    await sheet().getByRole('button', { name: 'Claude Code 少一份' }).click()
    await sheet().getByRole('button', { name: '高级' }).click()
    await expect(sheet().getByRole('group', { name: '分支名' })).toContainText(/每份一个分支：jacob\/[a-z]+-[a-z]+-1 … -3/)
    await shoot('sheet')
  })

  test('创建 makes three worktrees off main, starts each agent and sends the task to each exactly once', async () => {
    await sheet().getByRole('button', { name: /^创建 3 个并发送/ }).click()
    await expect(sheet()).toBeHidden()
    await expect(overview()).toBeVisible()
    await expect(overlay().getByTestId('attempt-compare')).toHaveCount(3, WITHIN)
    await expect(overlay().getByTestId('attempt-compare').first()).toContainText('Claude Code 1')
    await expect(overlay().getByTestId('attempt-compare').nth(2)).toContainText('Codex')

    await expect.poll(() => (existsSync(worktreesDir) ? readdirSync(worktreesDir).length : 0), WITHIN).toBe(3)
    folders = readdirSync(worktreesDir)
      .sort()
      .map((name) => join(worktreesDir, name))
    for (const dir of folders) await expect.poll(() => typed(dir), { timeout: 60_000 }).toContain(`${TASK}<ENTER>`)
    for (const dir of folders) expect(count(typed(dir), TASK)).toBe(1)
    // Each on its own branch from main.
    const branches = git(project, 'branch', '--format=%(refname:short)').trim().split('\n').filter((b) => b !== 'main')
    expect(branches).toHaveLength(3)
    expect(branches.map((b) => b.slice(-2)).sort()).toEqual(['-1', '-2', '-3'])
    for (const b of branches) expect(git(project, 'merge-base', 'main', b).trim()).toBe(git(project, 'rev-parse', 'main').trim())
    // The launch status line is gone once sent; the group is saved with the workspace.
    await expect(overlay().getByText('等 agent 启动后发送…')).toHaveCount(0, WITHIN)
    await expect.poll(() => readFileSync(join(profile, 'workspace.json'), 'utf8'), WITHIN).toContain('"attemptGroups"')
    await shoot('compare')
  })

  test('each member’s compare bar shows what it changed and the checks it ran', async () => {
    const ids = await memberIds()
    expect(ids).toHaveLength(3)
    const first = folders[0]!
    writeFileSync(join(first, 'login.ts'), 'export const steps = 2\n')
    git(first, 'add', 'login.ts')
    git(first, 'commit', '-q', '-m', 'two steps')
    step(first, { hook: 'UserPromptSubmit', payload: { prompt: TASK } })
    step(first, { hook: 'PostToolUse', payload: { tool_name: 'Edit', tool_input: { file_path: join(first, 'login.ts') }, tool_response: {} } })
    step(first, {
      hook: 'PostToolUse',
      payload: { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: ' Test Files  1 passed (1)\n      Tests  3 passed (3)\n', stderr: '' } }
    })
    step(first, { hook: 'Stop', payload: { last_assistant_message: '改成两步了。' } })
    const bar = overlay().locator(`[data-testid="attempt-compare"][data-member-id="${ids[0]}"]`)
    await expect(bar.getByTestId('attempt-diff')).toHaveText('+1 −0 · 1 个文件', WITHIN)
    await expect(bar.getByTestId('turn-checks')).toHaveAccessibleName(/这一轮：测试通过/, WITHIN)
    await expect(overlay().locator(`[data-testid="attempt-compare"][data-member-id="${ids[1]}"]`).getByTestId('attempt-diff')).toHaveText('还没有改动')
    await shoot('compare-diff')
    await page.keyboard.press('Escape')
    await expect(overlay()).toHaveCount(0)
    // The group row above the status groups opens the same comparison again.
    const row = overview().getByTestId('attempt-group')
    await expect(row).toContainText(TASK)
    await expect(row).toContainText('基于 main')
    await expect(row.locator('[data-member-id]')).toHaveCount(3)
    await shoot('overview-group')
  })

  test('⌘-picked sessions get one message, and only after the confirmation that names them', async () => {
    const ids = await overview()
      .getByTestId('attempt-group')
      .locator('[data-member-id]')
      .evaluateAll((els) => els.map((el) => (el as unknown as { dataset: { memberId: string } }).dataset.memberId))
    for (const id of ids) await overview().locator(`[role="option"][data-session-id="${id}"]`).click({ modifiers: ['Meta'] })
    // A shell picked too is skipped by 发送 and said so.
    await overview().locator('[role="option"][data-session-id="s-shell"]').click({ modifiers: ['Meta'] })
    const bar = page.getByTestId('batch-bar')
    await expect(bar).toContainText('已选 4 个')
    await expect(overview().locator('[data-picked="true"]')).toHaveCount(4)
    await bar.getByRole('button', { name: '发送消息…' }).click()
    await bar.getByRole('textbox', { name: '要发送的消息' }).fill(BROADCAST)
    await expect(bar.getByTestId('batch-recipients')).toContainText('跳过 1 个：终端不是 agent（终端）')
    await shoot('batch-compose')

    // Declined: nothing is typed anywhere.
    await answerDialogs(false)
    await bar.getByRole('button', { name: /^发送给 3 个/ }).click()
    await expect.poll(async () => (await dialogs()).at(-1)?.message).toBe('把这段话发给 3 个会话并按回车？')
    const confirm = (await dialogs()).at(-1)!
    expect(confirm.detail).toContain(`“${BROADCAST}”`)
    expect(confirm.detail).toContain('每个会话各算一轮，用你自己的额度。')
    expect(confirm.confirmLabel).toBe('发送给 3 个')
    await page.waitForTimeout(800)
    for (const dir of folders) expect(typed(dir)).not.toContain(BROADCAST)

    await answerDialogs(true)
    await bar.getByRole('button', { name: /^发送给 3 个/ }).click()
    for (const dir of folders) await expect.poll(() => typed(dir), WITHIN).toContain(`${BROADCAST}<ENTER>`)
    for (const dir of folders) expect(count(typed(dir), BROADCAST)).toBe(1)
    await expect(bar).toContainText('已发送给 3 个', WITHIN)
    await page.keyboard.press('Escape')
    await expect(bar).toHaveCount(0)
  })

  test('停止 sends one Esc to the running agent after the confirmation', async () => {
    const second = folders[1]!
    step(second, { hook: 'UserPromptSubmit', payload: { prompt: TASK } })
    step(second, { hook: 'PreToolUse', payload: { tool_name: 'Bash', tool_input: { command: 'npm test' } } })
    const ids = await overview()
      .getByTestId('attempt-group')
      .locator('[data-member-id]')
      .evaluateAll((els) => els.map((el) => (el as unknown as { dataset: { memberId: string } }).dataset.memberId))
    const running = overview().locator(`section[aria-label="运行中"] [data-session-id="${ids[1]}"]`)
    await expect(running).toBeVisible(WITHIN)
    await running.click({ modifiers: ['Meta'] })
    await overview().locator(`[role="option"][data-session-id="${ids[2]}"]`).click({ modifiers: ['Meta'] })
    const bar = page.getByTestId('batch-bar')
    await bar.getByRole('button', { name: '停止 1 个' }).click()
    await expect.poll(async () => (await dialogs()).at(-1)?.message).toBe('停止 1 个会话正在做的这一轮？')
    await expect.poll(() => typed(second), WITHIN).toContain('\u001b')
    expect(typed(folders[2]!)).not.toContain('\u001b')
    await expect(bar).toContainText('已停止 1 个', WITHIN)
    // The agent reports the interrupted turn; it can be archived later.
    step(second, { hook: 'Stop', payload: { last_assistant_message: '停下了。' } })
    await page.keyboard.press('Escape')
  })

  test('合并这个 goes through the merge sheet, which then offers to archive the other two', async () => {
    await overview().getByTestId('attempt-group').getByRole('button', { name: '比较' }).click()
    const ids = await memberIds()
    await overlay().locator(`[data-testid="attempt-compare"][data-member-id="${ids[0]}"]`).getByRole('button', { name: '合并这个' }).click()
    const merge = page.getByTestId('merge-sheet')
    await expect(merge).toBeVisible(WITHIN)
    await merge.getByRole('button', { name: /^合并/ }).click()
    const offer = merge.getByTestId('attempt-after-merge')
    await expect(offer).toContainText('一题多解还剩 2 份', WITHIN)
    await shoot('after-merge')
    await offer.getByRole('button', { name: '归档其余 2 份' }).click()
    await expect.poll(async () => (await dialogs()).at(-1)?.message, WITHIN).toBe('归档一题多解剩下的 2 份？')
    await expect(offer).toContainText('已归档其余几份', WITHIN)
    for (const id of ids.slice(1)) await expect(sidebar().locator(`[data-session-id="${id}"]`)).toHaveCount(0, WITHIN)
    expect(git(project, 'log', '-1', '--format=%s', 'main').trim()).not.toBe('init')
    await page.keyboard.press('Escape')
    await expect(merge).toBeHidden()
    // Nothing left to decide: the group leaves the overview.
    if (!(await overview().isVisible())) await page.keyboard.press('Meta+Shift+A')
    await expect(overview()).toBeVisible()
    await expect(overview().getByTestId('attempt-groups')).toHaveCount(0)
  })
})
