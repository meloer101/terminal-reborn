// 恢复后发送“继续” end to end (PRD F11). A fake `claude` (e2e/fake-hook-claude.ts) runs the real per-launch `--settings`:
// its statusLine relay reports the 5 h window used up and its StopFailure hook sends the payload Claude Code 2.1.304
// sent for a plan-limit 429 (PRD §6.6, scripts/spikes/60-rate-limit-lab.mjs) — so the stop travels the real path
// (relay → hook socket → main → renderer). The send itself is the real send protocol into the fake's PTY. Waits are
// shortened through `__TR_LIMIT_RESUME_TIMING__`; the account is never polled (TR_ACCOUNT_USAGE=off), so after the
// reset the passed reset time is what lets the send go. The menu that holds the send also refuses every other click
// that would type into the agent (PRD §6.7 / §6.9). Screenshots in both themes go to test-results/limit-resume/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { alive, fakeHookClaude } from './fake-hook-claude'
import { launchApp } from './launch'

const WITHIN = { timeout: 20_000 }
const SHOTS = join(process.cwd(), 'test-results', 'limit-resume')
const ID = 's-limit'
const MESSAGE = "You've hit your session limit · resets 5:22pm (America/Bogota)"
const TIMING = { marginMs: 1_500, freshWaitMs: 300, pollMs: 200 }
const MENU =
  '\r\n What do you want to do?\r\n ❯ 1. Wait here, then continue automatically at 5:22pm\r\n   2. Stop and wait for limit to reset\r\n\r\n Enter to confirm · Esc to cancel\r\n'
const REFUSAL = '终端里有选择框，请先在终端中处理'

interface Shown {
  title: string
  body: string
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

test.describe('continue after the plan limit resets', () => {
  const fake = fakeHookClaude('tr-e2e-limit-')
  const agent = fake.folder('acme-api')
  const profile = join(fake.root, 'profile')
  const claudeConfig = join(fake.root, 'claude-config')
  let app: ElectronApplication
  let page: Page

  const header = () => page.locator('[data-region="main"] header').first()
  const toggle = () => header().getByTestId('limit-resume')
  const usageChip = () => header().getByTestId('usage-chip-claude')
  const errorBar = () => page.getByTestId('session-error')
  const row = () => page.locator(`[data-region="sidebar"] [data-session-id="${ID}"]`)
  const shown = () => app.evaluate(() => (globalThis as unknown as { __shown: Shown[] }).__shown)
  const screen = () =>
    page.evaluate((id) => (globalThis as unknown as { __trTerminals?: { readScreen(id: string, n?: number): string } }).__trTerminals?.readScreen(id, 50) ?? '', ID)
  /** How many times 继续 + Enter reached the agent (the send protocol pastes the text, then presses Enter). */
  // eslint-disable-next-line no-control-regex
  const continues = () => agent.typed().replace(/\x1b\[20[01]~/g, '').split('继续<ENTER>').length - 1
  /** What reached the agent, without the bracketed-paste markers the send protocol wraps text in. */
  // eslint-disable-next-line no-control-regex
  const typedText = () => agent.typed().replace(/\x1b\[20[01]~/g, '')
  const clock = (ms: number) => {
    const d = new Date(ms)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const setTheme = (theme: 'dark' | 'light') =>
    page.evaluate((t) => {
      ;(globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document.documentElement.dataset.theme = t
    }, theme)

  /** One turn that the plan limit stops: the 5 h window is used up until `resetsAt` (epoch ms). */
  function hitLimit(resetsAt: number) {
    const seconds = Math.floor(resetsAt / 1000)
    agent.step({ hook: 'UserPromptSubmit', payload: { prompt: '把登录页改成中文' } })
    agent.step({
      statusLine: {
        model: { display_name: 'Opus 5.5' },
        rate_limits: { five_hour: { used_percentage: 100, resets_at: seconds }, seven_day: { used_percentage: 42, resets_at: seconds + 4 * 86400 } }
      }
    })
    agent.step({ hook: 'StopFailure', payload: { error: 'rate_limit', last_assistant_message: MESSAGE } })
  }

  test.beforeAll(async () => {
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(agent.path, 'notes.txt'), 'notes\n')
    mkdirSync(claudeConfig, { recursive: true })
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p-acme', name: 'acme-api', rootPath: agent.path }],
        worktrees: [{ id: 'w-acme', projectId: 'p-acme', branch: '', path: agent.path, isMain: true }],
        sessions: [{ id: ID, worktreeId: 'w-acme', kind: 'claude', title: '登录页中文化', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: ID,
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
    // Our statusLine relay must not chain the developer's own statusLine: a Claude config dir of our own.
    app = await launchApp({ ...fake.env, CLAUDE_CONFIG_DIR: claudeConfig }, { userDataDir: profile })
    await app.evaluate(({ Notification }) => {
      const g = globalThis as unknown as { __shown: Shown[] }
      g.__shown = []
      Notification.prototype.show = function (this: Electron.Notification) {
        g.__shown.push({ title: this.title, body: this.body })
      }
    })
    page = await app.firstWindow()
    // Reading the screen (to know when a printed menu is there) is opt-in, and set before the page's scripts run.
    await page.addInitScript(() => {
      ;(globalThis as unknown as { __TR_TERMINAL_PROBE__: boolean }).__TR_TERMINAL_PROBE__ = true
    })
    await page.reload()
    await expect(row()).toBeVisible(WITHIN)
    await row().click()
    await expect.poll(agent.pid, WITHIN).not.toBeNull()
    await page.evaluate((t) => {
      ;(globalThis as unknown as { __TR_LIMIT_RESUME_TIMING__: unknown }).__TR_LIMIT_RESUME_TIMING__ = t
    }, TIMING)
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    if (alive(agent.pid())) process.kill(agent.pid() as number, 'SIGTERM')
  })

  let reset1 = 0

  test('a plan-limit stop shows when it resets and offers 恢复后发送“继续”; the error bar offers no fix', async () => {
    // Long enough for the next three tests to run before it.
    reset1 = Date.now() + 35_000
    hitLimit(reset1)
    await expect(usageChip()).toContainText(`5h 用完 · ${clock(reset1)} 恢复`, WITHIN)
    await expect(toggle()).toHaveText('恢复后发送“继续”')
    await expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    await expect(errorBar()).toContainText(`Claude 额度用完 · ${clock(reset1)} 恢复`)
    await expect(errorBar().getByRole('button', { name: '让 agent 修复' })).toHaveCount(0)
    await expect(errorBar().getByRole('button', { name: '重试这一轮' })).toBeVisible()
  })

  test('the overview row says the same and has the same toggle', async () => {
    await page.locator('[data-region="sidebar"]').getByText('总览').click()
    const overviewRow = page.locator(`[data-region="overview"] [data-session-id="${ID}"]`)
    await expect(overviewRow.getByTestId('limit-resume-summary')).toContainText(`Claude 额度用完 · ${clock(reset1)} 恢复`, WITHIN)
    await overviewRow.getByTestId('limit-resume').click()
    await expect(overviewRow.getByTestId('limit-resume')).toHaveAttribute('aria-pressed', 'true')
    // The click did not expand the row.
    await expect(overviewRow).toHaveAttribute('aria-expanded', 'false')
    await overviewRow.getByTestId('limit-resume').click()
    await expect(overviewRow.getByTestId('limit-resume')).toHaveAttribute('aria-pressed', 'false')
    await row().click()
    await expect(toggle()).toBeVisible()
  })

  test('the toggle shows when it will type, and a second click calls it off', async () => {
    await toggle().click()
    await expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    await expect(toggle()).toHaveText(`${clock(reset1 + TIMING.marginMs)} 发送“继续”`)
    mkdirSync(SHOTS, { recursive: true })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(theme)
      await page.waitForTimeout(150)
      await header().screenshot({ path: join(SHOTS, `header-armed-${theme}.png`) })
    }
    await setTheme('dark')
    await toggle().click()
    await expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    await expect(toggle()).toHaveText('恢复后发送“继续”')
  })

  test('typing into the session calls it off', async () => {
    await toggle().click()
    await expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    await page.locator('[data-region="terminal"] [data-active="true"]').click()
    await page.keyboard.type('x')
    await expect.poll(agent.typed, WITHIN).toContain('x')
    await expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    // Leave the input line empty again.
    await page.keyboard.press('Backspace')
  })

  test('at the reset Wavi types 继续 and presses Enter, once — also with the window closed (hidden)', async () => {
    const throttled = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getBackgroundThrottling())
    expect(await throttled()).toBe(true)
    await toggle().click()
    await expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    // A hidden window keeps its timers at full speed while the send waits.
    await expect.poll(throttled).toBe(false)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    expect(continues()).toBe(0)
    await expect.poll(continues, { timeout: 60_000 }).toBe(1)
    await expect.poll(throttled).toBe(true)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show())
    // The agent goes on (Claude's UserPromptSubmit comes ~75 ms after Enter): the turn runs and finishes like any other.
    agent.step({ hook: 'UserPromptSubmit', payload: { prompt: '继续' } })
    await expect(toggle()).toHaveCount(0, WITHIN)
    agent.step({ hook: 'Stop', payload: { last_assistant_message: '登录页已经改成中文。' } })
    await expect(row().getByRole('img', { name: '空闲' }).or(row().getByRole('img', { name: '已完成' }))).toBeVisible(WITHIN)
    await expect(errorBar()).toHaveCount(0)
    await page.waitForTimeout(TIMING.marginMs + 1_000)
    expect(continues()).toBe(1)
  })

  test('with a menu over the input line (Claude’s /rate-limit-options) neither the send nor 重试这一轮 types, and both say so', async () => {
    const reset2 = Date.now() + 6_000
    hitLimit(reset2)
    await expect(toggle()).toBeVisible(WITHIN)
    await toggle().click()
    await expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    agent.step({
      print: '\r\n What do you want to do?\r\n ❯ 1. Wait here, then continue automatically at 5:22pm\r\n   2. Stop and wait for limit to reset\r\n\r\n Enter to confirm · Esc to cancel\r\n'
    })
    await expect.poll(async () => (await shown()).map((n) => n.body).join('\n'), { timeout: 30_000 }).toContain('选择框')
    expect((await shown()).at(-1)?.title).toBe('acme-api · 登录页中文化')
    await expect(toggle()).toHaveCount(0, WITHIN)
    expect(continues()).toBe(1)
    // The menu is still on screen: a click on the error bar is refused before anything is typed (PRD §6.7).
    const typed = agent.typed()
    await errorBar().getByRole('button', { name: '重试这一轮' }).click()
    await expect(errorBar()).toContainText('没能完成：终端里有选择框，请先在终端中处理')
    await page.waitForTimeout(500)
    expect(agent.typed()).toBe(typed)
    agent.step({ print: '\x1b[2J\x1b[H❯ ' })
  })

  test('with the menu open, /compact and 插入路径到终端 are refused too: each says so where it was clicked, and nothing is typed', async () => {
    agent.step({
      statusLine: {
        model: { display_name: 'Opus 5.5' },
        context_window: { context_window_size: 200000, used_percentage: 86, current_usage: { input_tokens: 2, cache_creation_input_tokens: 1998, cache_read_input_tokens: 170000 } }
      }
    })
    const compact = header().getByTestId('context-chip').getByRole('button', { name: '/compact' })
    await expect(compact).toBeVisible(WITHIN)
    await header().getByRole('group', { name: '右侧栏' }).getByRole('button', { name: '文件' }).click()
    const panel = page.locator('[data-region="panel"]')
    const notes = panel.getByRole('tree', { name: '文件' }).locator('[role="treeitem"][data-path="notes.txt"]')
    await expect(notes).toBeVisible(WITHIN)

    agent.step({ print: MENU })
    await expect.poll(screen, WITHIN).toContain('What do you want to do?')
    const before = typedText()
    mkdirSync(SHOTS, { recursive: true })

    await compact.click()
    await expect(page.getByTestId('compact-refusal')).toHaveText(REFUSAL)
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(theme)
      await page.waitForTimeout(150)
      await page.screenshot({ path: join(SHOTS, `compact-refused-${theme}.png`) })
    }
    await setTheme('dark')

    await notes.click({ button: 'right' })
    await page.getByRole('menu').getByRole('menuitem', { name: /插入路径到终端/ }).click()
    await expect(panel.getByTestId('files-notice')).toHaveText(`没有插入路径：${REFUSAL}`)
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(theme)
      await page.waitForTimeout(150)
      await page.screenshot({ path: join(SHOTS, `insert-path-refused-${theme}.png`) })
    }
    await setTheme('dark')

    await page.waitForTimeout(500)
    expect(typedText()).toBe(before)

    // The menu is dealt with: both buttons type again, and the notices are gone.
    agent.step({ print: '\x1b[2J\x1b[H❯ ' })
    await expect.poll(screen, WITHIN).not.toContain('What do you want to do?')
    await compact.click()
    await expect.poll(typedText, WITHIN).toContain('/compact')
    await expect(page.getByTestId('compact-refusal')).toHaveCount(0)
    await notes.click({ button: 'right' })
    await page.getByRole('menu').getByRole('menuitem', { name: /插入路径到终端/ }).click()
    await expect.poll(typedText, WITHIN).toContain('@notes.txt')
    await expect(panel.getByTestId('files-notice')).toHaveCount(0)
    await header().getByRole('group', { name: '右侧栏' }).getByRole('button', { name: '文件' }).click()
    await expect(panel).toHaveCount(0)
    // Leave the input line empty again.
    await page.locator('[data-region="terminal"] [data-active="true"]').click()
    await page.keyboard.press('Control+U')
  })

  test('a reading after the reset that still says used up moves the send to the later reset', async () => {
    const reset3 = Date.now() + 6_000
    hitLimit(reset3)
    await expect(toggle()).toBeVisible(WITHIN)
    await toggle().click()
    await expect(toggle()).toHaveText(`${clock(reset3 + TIMING.marginMs)} 发送“继续”`)
    // The vendor moved the reset: the same window, still at 100 %, until three minutes later.
    const later = reset3 + 3 * 60_000
    agent.step({ statusLine: { rate_limits: { five_hour: { used_percentage: 100, resets_at: Math.floor(later / 1000) } } } })
    await expect(toggle()).toHaveText(`${clock(later + TIMING.marginMs)} 发送“继续”`, { timeout: 30_000 })
    await expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(continues()).toBe(1)
    await toggle().click()
    await expect(toggle()).toHaveAttribute('aria-pressed', 'false')
  })
})
