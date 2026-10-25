// Session metrics end to end (PRD F11 / F12, Figma 17A / 17B / 17C and 18). A fake `claude` runs the real per-launch
// `--settings` file: its statusLine command (our relay, chaining the project's own statusLine) and its hook commands,
// on steps the test appends to a file — so context %, plan usage and the todo list travel the real path
// (relay → hook socket → bridge → IPC → header / sidebar / overview). Codex readings are sent from main the way the
// bridge sends them (its rollout reader is unit-tested). Context history and session shares come from transcript files
// the test writes under a temporary CLAUDE_CONFIG_DIR, named by the hooks the way Claude names them. Screenshots in
// both themes go to test-results/session-meta/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { outerClaudeEnv } from './fake-claude'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'session-meta')
const WITHIN = { timeout: 20_000 }

// Reads its `--settings` file like Claude does and runs what is in it. Every byte typed is logged (Enter as <ENTER>).
const FAKE_CLAUDE = `#!/usr/bin/env node
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const at = process.argv.indexOf('--settings')
const settings = at > 0 ? JSON.parse(fs.readFileSync(process.argv[at + 1], 'utf8')) : {}
const log = process.env.TR_FAKE_LOG
const run = (command, payload) => {
  try {
    return execSync(command, { input: JSON.stringify(payload), encoding: 'utf8', timeout: 10000, shell: '/bin/sh' })
  } catch {
    return ''
  }
}
const hook = (event, payload) => {
  const entry = settings.hooks && settings.hooks[event] && settings.hooks[event][0].hooks[0]
  if (entry) run(entry.command, { hook_event_name: event, session_id: 'fake-conversation', cwd: process.cwd(), ...payload })
}
process.stdout.write('Claude Code v9.9.9\\r\\n\\r\\n❯ \\r\\n')
hook('SessionStart', { source: 'startup' })
// A worktree with its own .fake-steps file gets its own script (a second Claude session).
const stepsFile = fs.existsSync(process.cwd() + '/.fake-steps') ? process.cwd() + '/.fake-steps' : log + '.steps'
let seen = 0
setInterval(() => {
  let steps
  try {
    steps = fs.readFileSync(stepsFile, 'utf8').split('\\n').filter(Boolean)
  } catch {
    return
  }
  for (; seen < steps.length; seen++) {
    const step = JSON.parse(steps[seen])
    if (step.exit !== undefined) process.exit(step.exit)
    if (step.statusLine && settings.statusLine) fs.appendFileSync(log + '.statusline', run(settings.statusLine.command, step.statusLine) + '\\n')
    if (step.hook) hook(step.hook, step.payload || {})
  }
}, 150)
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.on('data', (d) => fs.appendFileSync(log, d.toString().replace(/\\r/g, '<ENTER>\\n')))
`

const FAKE_CODEX = `#!/bin/sh
[ "$1" = "app-server" ] && exit 1
printf 'OpenAI Codex (fake)\\n\\n› '
exec cat > /dev/null
`

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tr-e2e-meta-'))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  for (const dir of [bin, zdot]) mkdirSync(dir)
  writeFileSync(join(bin, 'claude'), FAKE_CLAUDE)
  writeFileSync(join(bin, 'codex'), FAKE_CODEX)
  chmodSync(join(bin, 'claude'), 0o755)
  chmodSync(join(bin, 'codex'), 0o755)
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\n`)
  const log = join(root, 'claude.log')
  writeFileSync(log, '')

  const project = join(root, 'acme-web')
  mkdirSync(project)
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  writeFileSync(join(project, 'README.md'), '# acme\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'add', '.')
  git(project, 'commit', '-q', '-m', 'init')
  const cookie = join(root, 'wt-cookie')
  const graph = join(root, 'wt-graph')
  const nav = join(root, 'wt-nav')
  git(project, 'worktree', 'add', '-q', '-b', 'jacob/session-cookie', cookie)
  git(project, 'worktree', 'add', '-q', '-b', 'jacob/graph-layout', graph)
  git(project, 'worktree', 'add', '-q', '-b', 'jacob/mobile-nav', nav)
  writeFileSync(join(nav, '.fake-steps'), '')
  // The plain terminal in the main folder: a claude typed there by hand reads its own script.
  writeFileSync(join(project, '.fake-steps'), '')
  // Claude's data directory for this run: transcripts the hooks point at must live under its projects/.
  const claudeConfig = join(root, 'claude-config')
  mkdirSync(join(claudeConfig, 'projects', 'acme'), { recursive: true })
  // The user's own statusLine for this project: ours must run it and print what it prints (PRD F11).
  mkdirSync(join(cookie, '.claude'))
  writeFileSync(join(cookie, '.claude', 'settings.local.json'), JSON.stringify({ statusLine: { type: 'command', command: "cat >/dev/null; printf 'USER-SL'" } }))

  return {
    root,
    project,
    cookie,
    graph,
    nav,
    env: { ...outerClaudeEnv(), ZDOTDIR: zdot, SHELL: '/bin/zsh', TR_FAKE_LOG: log, CLAUDE_CONFIG_DIR: claudeConfig },
    step: (value: unknown) => appendFileSync(`${log}.steps`, `${JSON.stringify(value)}\n`),
    shellStep: (value: unknown) => appendFileSync(join(project, '.fake-steps'), `${JSON.stringify(value)}\n`),
    statusLines: () => {
      try {
        return readFileSync(`${log}.statusline`, 'utf8')
      } catch {
        return ''
      }
    },
    typed: () => readFileSync(log, 'utf8').split(`${String.fromCharCode(27)}[201~`).join('').split(`${String.fromCharCode(27)}[200~`).join('')
  }
}

const NOW_S = Math.floor(Date.now() / 1000)
const statusLine = (percent: number, usage: { five: number; seven: number }) => ({
  statusLine: {
    session_id: 'fake-conversation',
    model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
    cost: { total_cost_usd: 3.4217 },
    context_window: {
      context_window_size: 200000,
      total_output_tokens: 38000,
      current_usage: { input_tokens: 2, cache_creation_input_tokens: 1998, cache_read_input_tokens: percent * 2000 - 2000 },
      used_percentage: percent
    },
    rate_limits: {
      five_hour: { used_percentage: usage.five, resets_at: NOW_S + 3 * 3600 },
      seven_day: { used_percentage: usage.seven, resets_at: NOW_S + 2 * 86400 }
    }
  }
})

const TODOS = [
  ['读取 session 中间件和现有 cookie 逻辑', 'completed'],
  ['新增 session_cookie 表的 prisma 迁移', 'completed'],
  ['改写 issueToken，写入 httpOnly cookie', 'completed'],
  ['补 middleware 刷新测试', 'in_progress'],
  ['删除 localStorage 里的旧 token', 'pending'],
  ['更新 README 的认证说明', 'pending'],
  ['跑完整测试并修复失败项', 'pending']
].map(([content, status]) => ({ content, status, activeForm: content }))

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

test.describe('session metrics: todo · context · usage', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-meta-profile-'))
  const repo = setup()
  let app: ElectronApplication
  let page: Page

  const header = () => page.locator('[data-region="main"] header').first()
  const sidebarRow = (id: string) => page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`)
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
  /** What main's bridge sends for a Codex session (its rollout reader is covered by codex-usage.test.ts). */
  const fromMain = (channel: string, payload: unknown) =>
    app.evaluate(({ BrowserWindow }, [c, p]) => BrowserWindow.getAllWindows()[0]?.webContents.send(c as string, p), [channel, payload] as const)

  test.beforeAll(async () => {
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'acme-web', rootPath: repo.project }],
        worktrees: [
          { id: 'w-main', projectId: 'p1', branch: 'main', path: repo.project, isMain: true },
          { id: 'w-cookie', projectId: 'p1', branch: 'jacob/session-cookie', path: repo.cookie, isMain: false, baseBranch: 'main' },
          { id: 'w-graph', projectId: 'p1', branch: 'jacob/graph-layout', path: repo.graph, isMain: false, baseBranch: 'main' },
          { id: 'w-nav', projectId: 'p1', branch: 'jacob/mobile-nav', path: repo.nav, isMain: false, baseBranch: 'main' }
        ],
        sessions: [
          { id: 's-cookie', worktreeId: 'w-cookie', kind: 'claude', title: 'Cookie 会话迁移', startedAt: 1, lastActivityAt: 1 },
          { id: 's-graph', worktreeId: 'w-graph', kind: 'codex', title: 'Git 图谱布局算法', startedAt: 1, lastActivityAt: 1 },
          { id: 's-main', worktreeId: 'w-main', kind: 'shell', title: 'main', startedAt: 1, lastActivityAt: 1 },
          { id: 's-nav', worktreeId: 'w-nav', kind: 'claude', title: '修复移动端导航抖动', startedAt: 1, lastActivityAt: 1 }
        ],
        activeSessionId: 's-cookie',
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
    app = await launchApp(repo.env, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible(WITHIN)
    // Notifications the renderer asks main for (Figma 18D), recorded next to main's own handler.
    await app.evaluate(({ ipcMain }) => {
      const g = globalThis as unknown as { __notes: unknown[] }
      g.__notes = []
      ipcMain.on('ui:notify', (_event, note) => g.__notes.push(note))
    })
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('the statusLine relay feeds context and usage, and still prints the user’s own statusLine', async () => {
    await expect(header().getByTestId('session-meta')).toHaveCount(0)
    repo.step(statusLine(62, { five: 13, seven: 26 }))
    await expect(header().getByTestId('context-chip')).toHaveText('context62%', WITHIN)
    await expect(header().getByTestId('usage-chip-claude')).toHaveText('Claude7d 26%')
    await expect.poll(repo.statusLines, WITHIN).toContain('USER-SL')
  })

  test('TodoWrite gives the header chip, the popover and the sidebar line', async () => {
    repo.step({ hook: 'PostToolUse', payload: { tool_name: 'TodoWrite', tool_input: { todos: TODOS }, tool_response: {} } })
    const chip = header().getByTestId('todo-chip')
    await expect(chip).toHaveText('3/7补 middleware 刷新测试', WITHIN)
    const line = sidebarRow('s-cookie').getByTestId('todo-line')
    await expect(line).toBeVisible()
    const ratio = await line.evaluate((el) => (el.firstElementChild as HTMLElement).offsetWidth / (el as HTMLElement).offsetWidth)
    expect(ratio).toBeCloseTo(3 / 7, 1)

    const inTerminal = () => page.evaluate(() => document.activeElement?.closest('[data-region="terminal"]') != null)
    await expect.poll(inTerminal).toBe(true)
    await chip.click()
    const popover = page.getByTestId('todo-popover')
    await expect(popover).toBeVisible()
    // The chip does not take the keyboard from the agent.
    expect(await inTerminal()).toBe(true)
    await expect(popover.getByRole('listitem')).toHaveCount(7)
    await expect(popover.locator('[data-state="current"]')).toHaveText('补 middleware 刷新测试')
    await expect(popover).toContainText('3 / 7 已完成')
    await expect(popover).toContainText('来自 Claude 的 TodoWrite · 只读')
    await shoot('17A-todo-popover')
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
  })

  test('context ≥ 80%: heavier number, /compact only fills the input line', async () => {
    repo.step(statusLine(86, { five: 13, seven: 26 }))
    const chip = header().getByTestId('context-chip')
    await expect(chip).toHaveAttribute('data-level', 'high', WITHIN)
    await shoot('17B-context-high')
    await chip.getByRole('button', { name: '/compact' }).click()
    await expect.poll(repo.typed, WITHIN).toContain('/compact')
    await page.waitForTimeout(500)
    expect(repo.typed()).not.toContain('<ENTER>')
  })

  test('clicking context opens its popover: the figure and the bar with its mark, nothing else', async () => {
    const chip = header().getByTestId('context-chip')
    await chip.getByRole('button', { name: 'context 已用 86%' }).click()
    const popover = page.getByTestId('context-popover')
    await expect(popover).toBeVisible()
    await expect(popover).toContainText('172k/ 200k86%')
    // No model line, no mark note, no trend: the popover is only the number and the bar.
    await expect(popover).not.toContainText('Opus')
    await expect(popover).not.toContainText('刻度')
    await expect(popover).not.toContainText('最近')
    await expect(popover.locator('svg')).toHaveCount(0)
    await expect(popover.getByRole('button', { name: '/compact' })).toHaveCount(0)
    await shoot('27B-context-popover')
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
  })

  test('usage is per vendor: the popover lists this session’s vendor first, ≥ 80% is heavier', async () => {
    await fromMain('agent:usage', {
      vendor: 'codex',
      at: Date.now(),
      windows: [
        { minutes: 300, percent: 40, resetsAt: Date.now() + 5 * 3600_000 },
        { minutes: 10080, percent: 12, resetsAt: Date.now() + 5 * 86400_000 }
      ]
    })
    repo.step(statusLine(62, { five: 13, seven: 84 }))
    const chip = header().getByTestId('usage-chip-claude')
    await expect(chip).toHaveText('Claude7d 84%', WITHIN)
    await expect(chip).toHaveAttribute('data-level', 'high')
    await chip.click()
    const popover = page.getByTestId('usage-popover')
    await expect(popover.getByRole('region')).toHaveText([/^Claude5 小时.*13%.*7 天.*84%/, /^Codex5 小时.*40%.*每周.*12%/])
    // 5 h: 2 of 5 hours gone, 13 % used — on pace. 7 d: 5 of 7 days gone, 84 % used — ahead (a heavier figure, no sentence).
    await expect(popover.getByTestId('usage-window-claude-300')).toHaveAttribute('data-level', 'normal')
    await expect(popover.getByTestId('usage-window-claude-10080')).toHaveAttribute('data-level', 'ahead')
    for (const gone of ['当前会话', '刚刚更新', '时间过了', '用得比时间快', '各会话的用量', 'API 价格']) await expect(popover).not.toContainText(gone)
    await shoot('27B-usage-popover')
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
  })

  test('crossing 75 % of a window raises one system notification; clicking it opens the overview’s usage popover', async () => {
    const notes = () => app.evaluate(() => (globalThis as unknown as { __notes: { title: string; body: string; tag: string }[] }).__notes)
    // The 7-day window went to 84 % above: one alert at 75, not one per reading.
    await expect.poll(async () => (await notes()).map((n) => n.title), WITHIN).toEqual(['Claude 7 天额度已用 84%'])
    repo.step(statusLine(62, { five: 13, seven: 85 }))
    await page.waitForTimeout(1500)
    expect((await notes()).length).toBe(1)
    const [note] = await notes()
    await fromMain('ui:notification-click', note!.tag)
    const overview = page.locator('[data-region="overview"]')
    await expect(overview).toBeVisible()
    await expect(page.getByTestId('usage-popover')).toBeVisible()
    await page.keyboard.press('Escape')
    await sidebarRow('s-cookie').click()
  })

  test('a narrow header drops the todo item, then the vendor, then the branch', async () => {
    await header().getByRole('button', { name: 'Git', exact: true }).click()
    await expect(page.locator('[data-region="panel"]')).toBeVisible()
    await expect.poll(() => header().evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(720)
    await expect(header().locator('[data-part="todo-current"]')).toBeHidden()
    await expect(header().locator('[data-part="usage-vendor"]')).toBeHidden()
    await expect(header().getByText('jacob/session-cookie')).toBeHidden()
    await expect(header().getByTestId('todo-chip')).toHaveText('3/7', { useInnerText: true })
    await shoot('17B-narrow')
    await page.locator('[data-region="panel"]').getByRole('button', { name: '关闭右侧栏' }).click()
  })

  test('a Codex session shows its context and Codex usage, and no todo', async () => {
    await fromMain('agent:event', { sessionId: 's-graph', agent: 'codex', at: Date.now(), event: { type: 'context', context: { percent: 41, usedTokens: 105000, windowTokens: 258400 } } })
    await sidebarRow('s-graph').click()
    await expect(header().getByTestId('context-chip')).toHaveText('context41%')
    await expect(header().getByTestId('usage-chip-codex')).toHaveText('Codex5h 40%')
    await expect(header().getByTestId('todo-chip')).toHaveCount(0)
    await expect(header().getByTestId('usage-chip-claude')).toHaveCount(0)
    await shoot('17B-codex')
  })

  test('the overview has todo / context columns and one usage chip per vendor', async () => {
    await page.locator('[data-region="sidebar"]').getByText('总览').click()
    const overview = page.locator('[data-region="overview"]')
    await expect(overview.getByTestId('plan-usage')).toBeVisible()
    await expect(overview.getByTestId('usage-chip-claude')).toHaveText('Claude7d 85%')
    await expect(overview.getByTestId('usage-chip-codex')).toHaveText('Codex5h 40%')
    const row = (id: string) => overview.locator(`[data-session-id="${id}"]`)
    await expect(row('s-cookie').getByTestId('overview-todo')).toHaveText('3/7')
    await expect(row('s-cookie').getByTestId('overview-context')).toHaveText('context 62%')
    await expect(row('s-graph').getByTestId('overview-todo')).toHaveText('')
    await expect(row('s-graph').getByTestId('overview-context')).toHaveText('context 41%')
    await expect(row('s-main').getByTestId('overview-context')).toHaveText('')
    await overview.getByTestId('usage-chip-claude').click()
    await expect(page.getByTestId('usage-popover').getByRole('region')).toHaveCount(2)
    await shoot('17C-overview')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  })

  test('a used-up window shows when it comes back instead of a percentage', async () => {
    await fromMain('agent:usage', {
      vendor: 'codex',
      at: Date.now(),
      windows: [
        { minutes: 300, percent: 100, resetsAt: Date.now() + 38 * 60_000 },
        { minutes: 10080, percent: 30, resetsAt: Date.now() + 5 * 86400_000 }
      ]
    })
    await page.locator('[data-region="sidebar"]').getByText('总览').click()
    const chip = page.locator('[data-region="overview"]').getByTestId('usage-chip-codex')
    await expect(chip).toHaveText(/^Codex5h 用完 · \d\d:\d\d 恢复$/, WITHIN)
    await expect(chip).toHaveAttribute('data-level', 'exhausted')
    await chip.click()
    await expect(page.getByTestId('usage-window-codex-300')).toContainText(/100%.*\d\d:\d\d 恢复/)
    await shoot('18C-exhausted')
    await page.keyboard.press('Escape')
  })

  test('/clear forgets the todo list and the context; usage stays', async () => {
    await sidebarRow('s-cookie').click()
    await expect(header().getByTestId('todo-chip')).toBeVisible()
    repo.step({ hook: 'SessionStart', payload: { source: 'clear' } })
    await expect(header().getByTestId('todo-chip')).toHaveCount(0, WITHIN)
    await expect(header().getByTestId('context-chip')).toHaveCount(0)
    await expect(header().getByTestId('usage-chip-claude')).toBeVisible()
    await expect(sidebarRow('s-cookie').getByTestId('todo-line')).toHaveCount(0)
  })

  test('a claude typed by hand in a plain terminal reports context and usage there, until it exits', async () => {
    await sidebarRow('s-main').click()
    const terminal = page.locator('[data-region="terminal"] .xterm:visible').first()
    await expect(terminal).toBeVisible(WITHIN)
    await expect(header().getByTestId('session-meta')).toHaveCount(0)
    // The terminal's zsh ran the user's .zshrc (which puts the fake CLIs first); the Wavi shim still comes first.
    await terminal.click()
    await page.keyboard.type('claude')
    await page.keyboard.press('Enter')
    repo.shellStep(statusLine(55, { five: 20, seven: 85 }))
    await expect(header().getByTestId('context-chip')).toHaveText('context55%', WITHIN)
    await expect(header().getByTestId('usage-chip-claude')).toHaveText('Claude7d 85%')
    await expect(page.locator('[data-region="sidebar"] [data-session-id="s-main"]')).toContainText('main')
    await shoot('shell-claude')
    repo.shellStep({ exit: 0 })
    await expect(header().getByTestId('context-chip')).toHaveCount(0, WITHIN)
    await expect(header().getByTestId('usage-chip-claude')).toHaveCount(0)
  })

  test('a claude on a third-party endpoint (CC Switch) shows its context, not the account’s usage', async () => {
    await sidebarRow('s-main').click()
    const terminal = page.locator('[data-region="terminal"] .xterm:visible').first()
    await expect(terminal).toBeVisible(WITHIN)
    // A fresh script: the fake replays its steps file from the top.
    writeFileSync(join(repo.project, '.fake-steps'), '')
    await terminal.click()
    // What CC Switch puts in ~/.claude/settings.json reaches the hooks as the agent's environment.
    await page.keyboard.type('ANTHROPIC_BASE_URL=https://api.moonshot.cn/anthropic claude')
    await page.keyboard.press('Enter')
    repo.shellStep(statusLine(30, { five: 20, seven: 85 }))
    await expect(header().getByTestId('context-chip')).toHaveText('context30%', WITHIN)
    await expect(header().getByTestId('usage-chip-claude')).toHaveCount(0)
    // The account's usage is still there for the sessions on it.
    await expect(page.locator('[data-region="sidebar"]')).toBeVisible()
    await sidebarRow('s-cookie').click()
    await expect(header().getByTestId('usage-chip-claude')).toBeVisible(WITHIN)
    repo.shellStep({ exit: 0 })
  })
})
