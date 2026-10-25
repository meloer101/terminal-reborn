// 同任务多解 + 广播 end to end (PRD F4 v1.68 / F9 / F15, Figma 26) on a real repository. Fake agents: `claude` that runs
// the per-launch hooks (e2e/fake-hook-claude.ts) and a `codex` that only draws its UI; each logs its arguments to
// `.fake-argv` and what was typed into it to `.fake-typed` in the folder it runs in. A Claude session says the task;
// ⇧⌘N opens 同任务多解 with it, and Claude Code ×2 · Codex ×1 makes three worktrees off that session's branch, each
// starting with the task on its command line, nested under the session in the sidebar; the overview compares them
// (diff, checks, compare bar); ⌘-picked rows get one message only after the confirmation; 停止 sends Esc; once all
// three stopped, the session gets one report (held for 送进去, as the fake has no inbox); merging one offers to
// archive the other two, which happens only after its confirmation. Screenshots in both themes go to
// test-results/attempts/.
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
const PLAN = '1. 登录页拆成两步\n2. 补上两步的测试'

// Draws a Codex-like screen (Wavi reads `OpenAI Codex` as its UI) and echoes and logs every byte typed.
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require('node:fs')
// Wavi's version check runs it from its own folder: answer and leave no files behind.
if (process.argv[2] === '--version') {
  process.stdout.write('codex-cli 9.9.9\\n')
  process.exit(0)
}
const dir = process.cwd()
fs.writeFileSync(dir + '/.fake-pid', String(process.pid))
fs.writeFileSync(dir + '/.fake-argv', JSON.stringify(process.argv.slice(2)))
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

test.describe('同任务多解 + 广播', () => {
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
  const sheet = () => page.getByTestId('same-task-sheet')
  const argv = (dir: string) => (existsSync(join(dir, '.fake-argv')) ? (JSON.parse(readFileSync(join(dir, '.fake-argv'), 'utf8')) as string[]).join('\n') : '')
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
        sessions: [
          { id: 's-orig', worktreeId: 'w-main', kind: 'claude', title: '登录改版', startedAt: 1, lastActivityAt: 1 },
          { id: 's-shell', worktreeId: 'w-main', kind: 'shell', title: '终端', startedAt: 1, lastActivityAt: 1 }
        ],
        activeSessionId: 's-orig',
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
    for (const dir of [...folders, project]) {
      const pid = existsSync(join(dir, '.fake-pid')) ? Number(readFileSync(join(dir, '.fake-pid'), 'utf8')) : 0
      try {
        if (pid) process.kill(pid, 'SIGTERM')
      } catch {
        // Already gone.
      }
    }
  })

  test('the plan bar opens 同任务多解 from the plan; what was said in the session is the other source', async () => {
    // The new-session sheet no longer offers several agents at once.
    await page.keyboard.press('Meta+N')
    const newSession = page.getByTestId('new-session-sheet')
    await expect(newSession).toBeVisible()
    await newSession.getByRole('button', { name: '智能体' }).click()
    await expect(page.getByRole('listbox', { name: '智能体' }).getByRole('option', { name: '终端' })).toBeVisible()
    await expect(page.getByRole('listbox', { name: '智能体' }).getByRole('option', { name: /多个/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(newSession).toBeHidden()

    // The session's agent hears the task (its prompt hook), then 同任务多解 starts from it.
    await expect.poll(() => (existsSync(join(project, '.fake-pid')) ? 1 : 0), WITHIN).toBe(1)
    step(project, { hook: 'UserPromptSubmit', payload: { prompt: TASK } })
    step(project, { hook: 'Stop', payload: { last_assistant_message: '先看看。' } })
    // Its agent writes a plan and waits for it to be approved: the bar under the terminal offers 同任务多解.
    step(project, { hook: 'PreToolUse', payload: { tool_name: 'ExitPlanMode', tool_input: { plan: PLAN } } })
    const planBar = page.getByTestId('plan-strip')
    await expect(planBar).toContainText('Claude Code 写好了计划', WITHIN)
    await expect(planBar).toContainText('1. 登录页拆成两步')
    await shoot('plan-strip')
    await planBar.getByRole('button', { name: /同任务多解/ }).click()
    await expect(sheet()).toBeVisible(WITHIN)
    await expect(sheet().getByRole('group', { name: '汇报给' })).toContainText('登录改版 · Claude Code')
    await expect(sheet().getByRole('button', { name: '任务来自' })).toContainText('Claude Code 写好的计划')
    await expect(sheet().getByRole('textbox', { name: '任务' })).toHaveValue(PLAN)
    await sheet().getByRole('button', { name: '任务来自' }).click()
    await page.getByRole('listbox', { name: '任务来自' }).getByRole('option', { name: /说过的 1 句话/ }).click()
    await expect(sheet().getByRole('textbox', { name: '任务' })).toHaveValue(TASK)
    // Approved in its TUI: the bar goes.
    step(project, { hook: 'PostToolUse', payload: { tool_name: 'ExitPlanMode', tool_input: {}, tool_response: {} } })
    await expect(planBar).toHaveCount(0, WITHIN)
    await expect(sheet().getByRole('button', { name: '基于' })).toContainText('main（原会话）', WITHIN)
    // The session's agent first, then the other installed ones, one part each.
    await expect(sheet().getByRole('group', { name: 'Claude Code 份数' })).toContainText('1', WITHIN)
    await expect(sheet().getByRole('group', { name: 'Codex 份数' })).toContainText('1')
    // CLIs installed on this machine beyond the fakes (the login shell's PATH) are not part of this test.
    const rows = await sheet()
      .getByRole('group', { name: /^.+ 份数$/ })
      .evaluateAll((els) => els.map((el) => (el as unknown as { getAttribute(name: string): string | null }).getAttribute('aria-label') ?? ''))
    for (const label of rows) {
      const agent = label.replace(/ 份数$/, '')
      if (agent !== 'Claude Code' && agent !== 'Codex') await sheet().getByRole('button', { name: `${agent} 少一份` }).click()
    }
    // A row stepped down to 0 leaves the list.
    for (const label of rows) if (!['Claude Code 份数', 'Codex 份数'].includes(label)) await expect(sheet().getByRole('group', { name: label })).toHaveCount(0)
    await expect(sheet().getByRole('button', { name: /^开 2 份并发送/ })).toBeEnabled()
    await sheet().getByRole('button', { name: 'Claude Code 多一份' }).click()
    await expect(sheet().getByRole('button', { name: /^开 3 份并发送/ })).toBeEnabled()
    // 加一个智能体 lists what is installed and how many each has.
    await sheet().getByRole('button', { name: '加一个智能体' }).click()
    const menu = page.getByRole('listbox', { name: '加一个智能体' })
    await expect(menu.getByRole('option', { name: /Claude Code.*已有 2 份/ })).toBeVisible()
    await page.keyboard.press('Escape')
    // An emptied task cannot be sent.
    await sheet().getByRole('textbox', { name: '任务' }).fill('')
    await expect(sheet().getByRole('button', { name: /^开 3 份并发送/ })).toBeDisabled()
    await sheet().getByRole('textbox', { name: '任务' }).fill(TASK)
    await shoot('sheet')
  })

  test('开 3 份并发送 makes three worktrees off the session’s branch, each starting with the task once, nested under it', async () => {
    await sheet().getByRole('button', { name: /^开 3 份并发送/ }).click()
    await expect(sheet()).toBeHidden()
    await expect(overview()).toBeVisible()
    await expect(overlay().getByTestId('attempt-compare')).toHaveCount(3, WITHIN)
    await expect(overlay().getByTestId('attempt-compare').first()).toContainText('Claude Code 1')
    await expect(overlay().getByTestId('attempt-compare').nth(2)).toContainText('Codex')

    await expect.poll(() => (existsSync(worktreesDir) ? readdirSync(worktreesDir).length : 0), WITHIN).toBe(3)
    folders = readdirSync(worktreesDir)
      .sort()
      .map((name) => join(worktreesDir, name))
    // On the command line, with Wavi's brief; nothing typed into the starting TUI.
    for (const dir of folders) await expect.poll(() => argv(dir), { timeout: 60_000 }).toContain(TASK)
    for (const dir of folders) {
      expect(count(argv(dir), TASK)).toBe(1)
      expect(argv(dir)).toContain('会话「登录改版」把同一个任务交给了 3 份')
      expect(typed(dir)).not.toContain(TASK)
    }
    // Each on its own branch from main, numbered from 2.
    const branches = git(project, 'branch', '--format=%(refname:short)').trim().split('\n').filter((b) => b !== 'main')
    expect(branches).toHaveLength(3)
    expect(branches.map((b) => b.slice(-2)).sort()).toEqual(['-2', '-3', '-4'])
    for (const b of branches) expect(git(project, 'merge-base', 'main', b).trim()).toBe(git(project, 'rev-parse', 'main').trim())
    await expect(overlay().getByText('等 agent 启动后发送…')).toHaveCount(0, WITHIN)
    await expect.poll(() => readFileSync(join(profile, 'workspace.json'), 'utf8'), WITHIN).toContain('"reportTo":"s-orig"')
    // In the sidebar they follow the session, one step in, by their agent's name.
    const nested = sidebar().locator('[data-depth="1"]')
    await expect(nested).toHaveCount(3, WITHIN)
    await expect(nested.first()).toContainText('Claude Code 1')
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
    await expect(row).toContainText('汇报给 登录改版')
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

  test('once all three stopped, the session gets one report, held for 送进去 without a channel', async () => {
    // The first and second parts ended their turns above; the Codex part's agent goes away.
    const codexPid = Number(readFileSync(join(folders[2]!, '.fake-pid'), 'utf8'))
    process.kill(codexPid, 'SIGTERM')
    await page.keyboard.press('Escape')
    await sidebar().locator('[data-session-id="s-orig"]').click()
    const strip = page.getByTestId('held-attempt-report')
    await expect(strip).toContainText('同任务多解的 3 份都做完了', { timeout: 45_000 })
    await expect(strip).toContainText('Claude Code 1 +1')
    await shoot('report-held')
    await strip.getByRole('button', { name: '送进去' }).click()
    await expect.poll(() => typed(project), WITHIN).toContain('[Wavi 同任务多解汇报]')
    expect(count(typed(project), '[Wavi 同任务多解汇报]')).toBe(1)
    expect(typed(project)).toContain('改成两步了。')
    expect(typed(project)).toContain('git diff main...<分支>')
    await expect(strip).toHaveCount(0)
    await page.keyboard.press('Meta+Shift+A')
    await expect(overview()).toBeVisible()
  })

  test('合并这个 goes through the merge sheet, which then offers to archive the other two', async () => {
    await overview().getByTestId('attempt-group').getByRole('button', { name: '比较' }).click()
    const ids = await memberIds()
    await overlay().locator(`[data-testid="attempt-compare"][data-member-id="${ids[0]}"]`).getByRole('button', { name: '合并这个' }).click()
    const merge = page.getByTestId('merge-sheet')
    await expect(merge).toBeVisible(WITHIN)
    await merge.getByRole('button', { name: /^合并/ }).click()
    const offer = merge.getByTestId('attempt-after-merge')
    await expect(offer).toContainText('同任务多解还剩 2 份', WITHIN)
    await shoot('after-merge')
    await offer.getByRole('button', { name: '归档其余 2 份' }).click()
    await expect.poll(async () => (await dialogs()).at(-1)?.message, WITHIN).toBe('归档同任务多解剩下的 2 份？')
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
