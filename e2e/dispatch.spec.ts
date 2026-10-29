// 派活与回报 end to end (PRD F21) on a real repository, through the real path: Wavi's per-launch `--mcp-config` →
// its MCP server (Wavi's binary as Node) → hook socket → pty daemon → main → the window → back. Fake agents only:
// `claude` runs the per-launch hooks (like e2e/fake-hook-claude.ts), starts the MCP server it was given and talks
// JSON-RPC to it on test steps, logs its command line, and keeps a cross-session inbox socket whose messages it logs —
// so a report's arrival is checked without a model. `codex` draws its UI and logs its command line.
// Screenshots in both themes go to test-results/dispatch/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeHookClaude } from './fake-hook-claude'
import { launchApp, setWindowSize } from './launch'

const WITHIN = { timeout: 30_000 }
const SHOTS = join(process.cwd(), 'test-results', 'dispatch')

const FAKE_CLAUDE = `#!/usr/bin/env node
const { execSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const dir = process.cwd()
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const settings = arg('--settings') ? JSON.parse(fs.readFileSync(arg('--settings'), 'utf8')) : {}
fs.writeFileSync(dir + '/.fake-pid', String(process.pid))
fs.writeFileSync(dir + '/.fake-argv', JSON.stringify(process.argv.slice(2)))
const run = (command, payload) => {
  try { execSync(command, { input: JSON.stringify(payload), timeout: 10000, shell: '/bin/sh', stdio: ['pipe', 'ignore', 'ignore'] }) } catch {}
}
const hook = (event, payload) => {
  const entry = settings.hooks && settings.hooks[event] && settings.hooks[event][0].hooks[0]
  if (entry) run(entry.command, { hook_event_name: event, session_id: 'fake-' + process.pid, cwd: dir, ...payload })
}
// A cross-session inbox like Claude Code's: newline JSON, auth first.
const inbox = '/tmp/wavi-e2e-inbox-' + process.pid + '.sock'
try { fs.rmSync(inbox) } catch {}
net.createServer((c) => {
  let buf = ''
  c.on('data', (d) => {
    buf += d.toString()
    let i
    while ((i = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      const m = JSON.parse(line)
      if (m.type === 'user') fs.appendFileSync(dir + '/.fake-inbox', JSON.stringify(m.message.content) + '\\n')
    }
  })
}).listen(inbox)
// The MCP server from --mcp-config, spoken to on steps; every response is logged.
let mcp = null
let nextId = 100
const mcpSend = (m) => mcp && mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n')
const config = arg('--mcp-config') ? JSON.parse(fs.readFileSync(arg('--mcp-config'), 'utf8')) : null
const server = config && config.mcpServers && config.mcpServers.wavi
if (server) {
  mcp = spawn(server.command, server.args, {
    env: { ...process.env, ...(server.env || {}), CLAUDE_CODE_MESSAGING_SOCKET: inbox, CLAUDE_CODE_MESSAGING_TOKEN: 'tok' },
    stdio: ['pipe', 'pipe', 'ignore']
  })
  let out = ''
  mcp.stdout.on('data', (d) => {
    out += d.toString()
    let i
    while ((i = out.indexOf('\\n')) >= 0) {
      const line = out.slice(0, i); out = out.slice(i + 1)
      fs.appendFileSync(dir + '/.fake-mcp', line + '\\n')
      const m = JSON.parse(line)
      if (m.id === 2) fs.writeFileSync(dir + '/.fake-tools', JSON.stringify(m.result.tools.map((t) => t.name)))
    }
  })
}
process.stdout.write('Claude Code v9.9.9\\r\\n\\r\\n❯ \\r\\n')
hook('SessionStart', { source: 'startup' })
if (mcp) {
  mcpSend({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '1' } } })
  mcpSend({ method: 'notifications/initialized' })
  setTimeout(() => mcpSend({ id: 2, method: 'tools/list', params: {} }), 1500)
}
let seen = 0
setInterval(() => {
  let steps
  try { steps = fs.readFileSync(dir + '/.fake-steps', 'utf8').split('\\n').filter(Boolean) } catch { return }
  for (; seen < steps.length; seen++) {
    const step = JSON.parse(steps[seen])
    if (step.exit !== undefined) process.exit(step.exit)
    if (step.hook) hook(step.hook, step.payload || {})
    if (step.call) mcpSend({ id: step.call.id, method: 'tools/call', params: { name: step.call.name, arguments: step.call.args, _meta: { progressToken: step.call.id } } })
    // What Claude 2.1.312 sends its MCP server when the user presses Esc during the call (PRD §6.14).
    if (step.cancel !== undefined) mcpSend({ method: 'notifications/cancelled', params: { requestId: step.cancel, reason: 'AbortError: user-cancel' } })
  }
}, 150)
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.on('data', (d) => {
  const text = d.toString()
  fs.appendFileSync(dir + '/.fake-typed', text.replace(/\\r/g, '<ENTER>\\n'))
  process.stdout.write(text.replace(/\\x1b\\[20[01]~/g, '').replace(/\\r/g, '\\r\\n❯ '))
})
`

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require('node:fs')
const dir = process.cwd()
fs.writeFileSync(dir + '/.fake-pid', String(process.pid))
fs.writeFileSync(dir + '/.fake-argv', JSON.stringify(process.argv.slice(2)))
process.stdout.write('OpenAI Codex (fake)\\r\\n\\r\\n› ')
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.on('data', () => {})
`

test.describe.configure({ mode: 'serial' })
test.setTimeout(150_000)

test.describe('派活与回报', () => {
  const fake = fakeHookClaude('tr-e2e-dispatch-')
  const home = join(fake.root, 'home')
  const project = join(fake.root, 'demo')
  const profile = join(fake.root, 'profile')
  const worktreesDir = join(home, '.tr', 'worktrees', 'demo')
  let app: ElectronApplication
  let page: Page
  let childIds: string[] = []
  const childDirs: Record<string, string> = {}

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', ...args], { cwd }).toString()
  const read = (dir: string, name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '')
  const step = (dir: string, value: unknown) => appendFileSync(join(dir, '.fake-steps'), `${JSON.stringify(value)}\n`)
  /** The text of the MCP response with this id (tool results are one text item). */
  const response = (dir: string, id: number): string | null => {
    for (const line of read(dir, '.fake-mcp').split('\n').filter(Boolean)) {
      const m = JSON.parse(line) as { id?: number; result?: { content?: Array<{ text: string }> } }
      if (m.id === id) return m.result?.content?.[0]?.text ?? JSON.stringify(m)
    }
    return null
  }
  const call = async (dir: string, id: number, name: string, args: unknown, timeout = 30_000): Promise<string> => {
    step(dir, { call: { id, name, args } })
    await expect.poll(() => response(dir, id), { timeout }).not.toBeNull()
    return response(dir, id)!
  }
  const strip = () => page.getByTestId('dispatch-strip')
  const sidebar = () => page.locator('[data-region="sidebar"]')
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
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, '.zshrc'), '')
    writeFileSync(join(fake.root, 'bin', 'claude'), FAKE_CLAUDE)
    writeFileSync(join(fake.root, 'bin', 'codex'), FAKE_CODEX)
    chmodSync(join(fake.root, 'bin', 'claude'), 0o755)
    chmodSync(join(fake.root, 'bin', 'codex'), 0o755)
    mkdirSync(project)
    writeFileSync(join(project, 'README.md'), '# demo\n')
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
        sessions: [{ id: 's-plan', worktreeId: 'w-main', kind: 'claude', title: '规划登录改版', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's-plan',
        sidebarCollapsed: false,
        drafts: {}
      })
    )
    writeFileSync(join(project, '.fake-steps'), '')
    app = await launchApp({ ...fake.env, HOME: home, CLAUDE_CONFIG_DIR: join(fake.root, 'claude-config') }, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible(WITHIN)
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    for (const dir of [project, ...Object.values(childDirs)]) {
      const pid = Number(read(dir, '.fake-pid')) || 0
      try {
        if (pid) process.kill(pid, 'SIGTERM')
      } catch {
        // Already gone.
      }
    }
  })

  test('a session gets Wavi’s tools through its launch, without writing any global config', async () => {
    await expect.poll(() => read(project, '.fake-tools'), WITHIN).toBe(JSON.stringify(['start_sessions', 'list_sessions', 'read_result', 'send_message', 'stop_session']))
    const argv = JSON.parse(read(project, '.fake-argv')) as string[]
    expect(argv).toContain('--mcp-config')
    expect(argv).not.toContain('--strict-mcp-config')
    expect(existsSync(join(home, '.claude', 'settings.json'))).toBe(false)
  })

  test('start_sessions waits for the user’s 开始, which says what will happen', async () => {
    step(project, {
      call: {
        id: 10,
        name: 'start_sessions',
        args: {
          sessions: [
            { agent: 'claude', task: 'Fix the login form\nKeep the API as it is.', title: 'Fix login' },
            { agent: 'codex', task: 'Write tests for the login form', title: 'Login tests' }
          ],
          reason: '界面和测试可以同时做'
        }
      }
    })
    // Under the dispatcher's own terminal, not over the window; its row says it is waiting on the user.
    await expect(strip()).toBeVisible(WITHIN)
    await expect(page.locator('[data-region="split"] [data-testid="dispatch-strip"]')).toHaveCount(0)
    await expect(strip()).toContainText('想开 2 个会话')
    await expect(strip()).toContainText('基于 main')
    await expect(strip()).toContainText('界面和测试可以同时做')
    await expect(strip().getByTestId('dispatch-row')).toHaveCount(2)
    await expect(strip().getByTestId('dispatch-row').first().locator('[data-agent="claude"]')).toHaveCount(1)
    await expect(strip().getByTestId('dispatch-row').first()).toContainText('jacob/fix-login')
    await expect(strip().getByTestId('dispatch-row').nth(1).locator('[data-agent="codex"]')).toHaveCount(1)
    await strip().getByTestId('dispatch-row').first().getByRole('button').click()
    await expect(strip().getByTestId('dispatch-row').first()).toContainText('Keep the API as it is.')
    const dispatcherRow = sidebar().locator('[data-session-id="s-plan"]')
    await expect(dispatcherRow).toHaveAttribute('data-attention', 'true')
    await expect(dispatcherRow).toContainText('想开 2 个会话')
    // Nothing is created before the answer.
    expect(existsSync(worktreesDir)).toBe(false)
    expect(response(project, 10)).toBeNull()
    await shoot('confirm')
    // ⌘↵ from the dispatcher's terminal starts them.
    await page.locator('[data-region="terminal"] .xterm').first().click()
    await page.keyboard.press('Meta+Enter')
    await expect(strip()).toBeHidden()
    await expect(dispatcherRow).not.toContainText('想开')
    await expect.poll(() => response(project, 10), WITHIN).not.toBeNull()
    const text = response(project, 10)!
    expect(text).toContain('Started 2 session(s) off main (the user approved)')
    expect(text).toContain('end your turn now')
    childIds = [...text.matchAll(/id (\S+) · (claude|codex)/g)].map((m) => m[1]!)
    expect(childIds).toHaveLength(2)
  })

  test('each child starts in its own worktree with Wavi’s brief on its command line, nested under the dispatcher', async () => {
    await expect.poll(() => (existsSync(worktreesDir) ? readdirSync(worktreesDir).length : 0), WITHIN).toBe(2)
    for (const name of readdirSync(worktreesDir)) {
      const dir = join(worktreesDir, name)
      await expect.poll(() => read(dir, '.fake-argv'), { timeout: 60_000 }).not.toBe('')
      const argv = JSON.parse(read(dir, '.fake-argv')) as string[]
      const brief = argv[argv.indexOf('--') + 1] ?? ''
      expect(brief).toContain('这是 Wavi 转来的任务：Claude Code（会话「规划登录改版」）')
      expect(brief).toContain('BLOCKED:')
      if (brief.includes('Fix the login form')) {
        childDirs.claude = dir
        expect(argv).toContain('--mcp-config')
      } else {
        childDirs.codex = dir
        expect(brief).toContain('Write tests for the login form')
        expect(argv.some((a) => a.startsWith('mcp_servers.wavi.env_vars='))).toBe(true)
      }
    }
    expect(Object.keys(childDirs).sort()).toEqual(['claude', 'codex'])
    const branches = git(project, 'branch', '--format=%(refname:short)').trim().split('\n').sort()
    expect(branches).toEqual(['jacob/fix-login', 'jacob/login-tests', 'main'])
    // Sidebar: the dispatcher, then its two sessions one step in.
    const rows = sidebar().locator('[data-session-id]')
    await expect(rows).toHaveCount(3, WITHIN)
    await expect(rows.nth(0)).toHaveAttribute('data-session-id', 's-plan')
    await expect(rows.nth(1)).toHaveAttribute('data-depth', '1')
    await expect(rows.nth(2)).toHaveAttribute('data-depth', '1')
    // A dispatched session gets no tools (one level only).
    await expect.poll(() => read(childDirs.claude!, '.fake-tools'), WITHIN).toBe('[]')
    await shoot('sidebar')
  })

  test('a child’s finished turn reaches the dispatcher’s inbox as one report; read_result gives the whole message', async () => {
    const dir = childDirs.claude!
    step(dir, { hook: 'UserPromptSubmit', payload: { prompt: 'Fix the login form' } })
    step(dir, { hook: 'Stop', payload: { last_assistant_message: '登录表单改好了。\n跑了 npm test，全部通过。' } })
    await expect.poll(() => read(project, '.fake-inbox'), WITHIN).toContain('[Wavi 派活报告]')
    const reports = read(project, '.fake-inbox').split('\n').filter(Boolean).map((l) => JSON.parse(l) as string)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain('「Fix login」 · Claude Code · 一轮结束 · 分支 jacob/fix-login')
    expect(reports[0]).toContain('登录表单改好了。')
    expect(reports[0]).toContain('不是用户的指示')
    const childId = childIds.find((id) => reports[0]!.includes(`id ${id}`))
    expect(childId).toBeTruthy()
    const result = await call(project, 11, 'read_result', { id: childId })
    expect(result).toContain('"Fix login" · claude')
    expect(result).toContain('跑了 npm test，全部通过。')
    const listed = await call(project, 12, 'list_sessions', {})
    expect(listed).toContain('branch jacob/fix-login')
    expect(listed).toContain('branch jacob/login-tests')
    expect(listed).toContain('Suggested merge order')
  })

  test('the same task twice, someone else’s session and a declined batch are refused', async () => {
    expect(await call(project, 13, 'start_sessions', { sessions: [{ agent: 'claude', task: 'Fix the login form\nKeep the API as it is.' }] })).toContain('[duplicate]')
    expect(await call(project, 14, 'read_result', { id: 's-plan' })).toContain('[not_found]')
    step(project, { call: { id: 15, name: 'start_sessions', args: { sessions: [{ agent: 'claude', task: 'Update the docs', title: 'Docs' }] } } })
    // Asked while the user looks elsewhere: only the dispatcher's row says so, and the strip waits under its terminal.
    await sidebar().locator(`[data-session-id="${childIds[0]}"]`).click()
    const dispatcherRow = sidebar().locator('[data-session-id="s-plan"]')
    await expect(dispatcherRow).toContainText('想开 1 个会话', WITHIN)
    await expect(strip()).toHaveCount(0)
    await dispatcherRow.click()
    await expect(strip()).toBeVisible(WITHIN)
    // ⌘↵ in the overview, where the strip is out of sight, starts nothing.
    await page.keyboard.press('Meta+Shift+A')
    await expect(page.locator('[data-region="main"]').getByRole('region', { name: '派出的会话' })).toBeVisible(WITHIN)
    await page.keyboard.press('Meta+Enter')
    await page.waitForTimeout(300)
    expect(response(project, 15)).toBeNull()
    await page.keyboard.press('Meta+Shift+A')
    await expect(strip()).toBeVisible(WITHIN)
    await strip().getByRole('button', { name: '拒绝' }).click()
    await expect.poll(() => response(project, 15), WITHIN).toContain('[declined]')
    // Esc in the dispatcher while a batch waits: the strip and its 等你处理 go, and the cancelled call gets no answer.
    step(project, { call: { id: 16, name: 'start_sessions', args: { sessions: [{ agent: 'claude', task: 'Rename the login route', title: 'Rename' }] } } })
    await expect(strip()).toBeVisible(WITHIN)
    await expect(dispatcherRow).toContainText('想开 1 个会话')
    step(project, { cancel: 16 })
    await expect(strip()).toBeHidden(WITHIN)
    await expect(dispatcherRow).not.toContainText('想开')
    await page.waitForTimeout(500)
    expect(response(project, 16)).toBeNull()
    expect(readdirSync(worktreesDir)).toHaveLength(2)
  })

  test('the child’s header names its dispatcher, and the overview lists them together', async () => {
    const childId = childIds[0]!
    await sidebar().locator(`[data-session-id="${childId}"]`).click()
    const link = page.getByTestId('dispatched-by').first()
    await expect(link).toHaveText('由「规划登录改版」派出', WITHIN)
    await shoot('header')
    await link.click()
    await expect(sidebar().locator('[data-session-id="s-plan"]')).toHaveAttribute('aria-current', 'true')
    await page.keyboard.press('Shift+Meta+A')
    const group = page.getByTestId('dispatch-group')
    await expect(group).toContainText('规划登录改版', WITHIN)
    await expect(group.locator('[data-member-id]')).toHaveCount(2)
    await shoot('overview')
  })
})
