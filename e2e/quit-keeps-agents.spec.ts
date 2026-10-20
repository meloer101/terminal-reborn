// Quitting with the pty daemon (PRD §6.8), as a user runs the app (TR_KILL_SESSIONS_ON_QUIT unset): ⌘Q with an agent
// mid-turn quits without asking and leaves the agent running; the relaunch reattaches to the same process, typing
// reaches it and its hooks keep moving the status; ⌥⌘Q asks first, and confirming ends the agent and the daemon.
// The agent is a fake `claude` that runs its real per-launch hooks (e2e/fake-hook-claude.ts).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { alive, fakeHookClaude } from './fake-hook-claude'
import { launchApp } from './launch'

interface DialogHook {
  requests: { message: string; confirmLabel: string }[]
  answer: boolean
}
const SESSION = 's-agent'
const WITHIN = { timeout: 20_000 }

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('quit keeps agents running', () => {
  const fake = fakeHookClaude('tr-e2e-quit-')
  const agent = fake.folder('agent-proj')
  const profile = join(fake.root, 'profile')
  let app: ElectronApplication
  let page: Page
  let agentPid = 0

  const row = () => page.locator(`[data-region="sidebar"] [data-session-id="${SESSION}"]`)
  const status = (name: string) => row().getByRole('img', { name })
  const dialogs = () => app.evaluate(() => (globalThis as unknown as { __trDialogs: DialogHook }).__trDialogs.requests)
  const daemonPid = (): number => (JSON.parse(readFileSync(join(profile, 'daemon', 'daemon.json'), 'utf8')) as { pid: number }).pid

  async function launch(): Promise<void> {
    app = await launchApp({ ...fake.env, TR_KILL_SESSIONS_ON_QUIT: undefined }, { userDataDir: profile })
    page = await app.firstWindow()
    await expect(row()).toBeVisible(WITHIN)
  }

  /** ⌘Q: AppKit's terminate: is app.quit(). A confirmation would be answered "cancel" and keep the app up. */
  async function quitLikeCmdQ(): Promise<void> {
    await app.evaluate(() => {
      ;(globalThis as unknown as { __trDialogs: DialogHook }).__trDialogs.answer = false
    })
    const closed = app.waitForEvent('close', { timeout: 15_000 })
    await app.evaluate(({ app: electronApp }) => electronApp.quit())
    await closed
  }

  test.beforeAll(() => {
    mkdirSync(profile, { recursive: true })
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'agent-proj', rootPath: agent.path }],
        worktrees: [{ id: 'w1', projectId: 'p1', branch: '', path: agent.path, isMain: true }],
        sessions: [{ id: SESSION, worktreeId: 'w1', kind: 'claude', title: '迁移 cookie', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: SESSION,
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    for (const pid of [agent.pid(), (() => {
      try {
        return daemonPid()
      } catch {
        return null
      }
    })()]) {
      if (alive(pid)) process.kill(pid as number, 'SIGTERM')
    }
  })

  test('⌘Q with an agent mid-turn quits without asking; the agent keeps running', async () => {
    await launch()
    await expect.poll(agent.pid, WITHIN).not.toBeNull()
    agentPid = agent.pid() as number
    agent.step({ hook: 'UserPromptSubmit', payload: { prompt: '把 session 存进 cookie' } })
    agent.step({ hook: 'PreToolUse', payload: { tool_name: 'Bash', tool_input: { command: 'pnpm test' } } })
    await expect(status('运行中')).toBeVisible(WITHIN)

    await quitLikeCmdQ()
    expect(alive(agentPid)).toBe(true)
    expect(alive(daemonPid())).toBe(true)
  })

  test('the relaunch reattaches the same agent: typing reaches it, its hooks still move the status', async () => {
    await launch()
    await expect(page.locator('[data-region="terminal"] .xterm').first()).toBeVisible(WITHIN)
    // No second launch: the same process is still the session's agent.
    await page.waitForTimeout(1500)
    expect(agent.pid()).toBe(agentPid)
    expect(alive(agentPid)).toBe(true)

    await page.locator(`[data-region="terminal"] [data-session-id="${SESSION}"]`).click()
    await page.keyboard.type('after-relaunch')
    await page.keyboard.press('Enter')
    await expect.poll(agent.typed, WITHIN).toContain('after-relaunch<ENTER>')

    agent.step({ hook: 'Notification', payload: { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' } })
    await expect(status('等你处理')).toBeVisible(WITHIN)
    agent.step({ hook: 'PostToolUse', payload: { tool_name: 'Bash', tool_input: { command: 'pnpm test' }, tool_response: {} } })
    await expect(status('运行中')).toBeVisible(WITHIN)
  })

  test('⌥⌘Q asks while the agent runs; cancel keeps it, confirm ends the agent and the daemon', async () => {
    const menuItem = () =>
      app.evaluate(({ Menu }) => {
        const entry = Menu.getApplicationMenu()?.items[0]?.submenu?.items.find((x) => x.label === '退出并结束所有会话…')
        if (!entry) throw new Error('no 退出并结束所有会话… item')
        entry.click()
      })
    await app.evaluate(() => {
      ;(globalThis as unknown as { __trDialogs: DialogHook }).__trDialogs.answer = false
    })
    const before = (await dialogs()).length
    await menuItem()
    await expect.poll(async () => (await dialogs()).length).toBe(before + 1)
    const request = (await dialogs())[before]
    expect(request?.message).toBe('有 1 个会话正在运行或等你处理，结束后它们会中断。')
    expect(request?.confirmLabel).toBe('结束并退出')
    await page.waitForTimeout(500)
    expect(alive(agentPid)).toBe(true)
    await expect(status('运行中')).toBeVisible()

    const daemon = daemonPid()
    await app.evaluate(() => {
      ;(globalThis as unknown as { __trDialogs: DialogHook }).__trDialogs.answer = true
    })
    const closed = app.waitForEvent('close', { timeout: 15_000 })
    await menuItem()
    await closed
    await expect.poll(() => alive(agentPid), WITHIN).toBe(false)
    await expect.poll(() => alive(daemon), WITHIN).toBe(false)
  })
})
