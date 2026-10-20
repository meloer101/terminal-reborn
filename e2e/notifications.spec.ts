// System notifications and the Dock badge through the real path (PRD F10): hook events from fake agents
// (e2e/fake-hook-claude.ts) → status → ui:notify / ui:set-badge → main's Electron Notification and app.dock. Only
// Notification#show is replaced, by a recorder, so nothing pops up on the desktop; clicking is the recorded
// notification's own 'click' event, which runs main's handler (show the window, tell the renderer the tag).
// How a notification looks on the desktop is left to the manual checklist.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { alive, fakeHookClaude } from './fake-hook-claude'
import { launchApp } from './launch'

interface Shown {
  title: string
  body: string
}
const WITHIN = { timeout: 20_000 }

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('notifications and Dock badge', () => {
  const fake = fakeHookClaude('tr-e2e-notify-')
  const agents = { 's-a': fake.folder('proj-a'), 's-b': fake.folder('proj-b'), 's-c': fake.folder('proj-c') }
  const titles = { 's-a': 'Cookie 迁移', 's-b': '修复导航抖动', 's-c': '图谱布局' }
  const profile = join(fake.root, 'profile')
  let app: ElectronApplication
  let page: Page

  const row = (id: string) => page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`)
  const shown = () => app.evaluate(() => (globalThis as unknown as { __shown: Shown[] }).__shown)
  const badge = () => app.evaluate(({ app: electronApp }) => electronApp.dock?.getBadge() ?? '')
  const isVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)
  /** Clicks the n-th notification main showed (its own 'click' event, as the system sends it). */
  const clickNotification = (n: number) =>
    app.evaluate((_electron, i) => {
      ;(globalThis as unknown as { __notes: Electron.Notification[] }).__notes[i]?.emit('click')
    }, n)

  test.beforeAll(async () => {
    mkdirSync(profile, { recursive: true })
    const ids = Object.keys(agents) as (keyof typeof agents)[]
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: ids.map((id) => ({ id: `p-${id}`, name: agents[id].path.split('/').at(-1), rootPath: agents[id].path })),
        worktrees: ids.map((id) => ({ id: `w-${id}`, projectId: `p-${id}`, branch: '', path: agents[id].path, isMain: true })),
        sessions: ids.map((id) => ({ id, worktreeId: `w-${id}`, kind: 'claude', title: titles[id], startedAt: 1, lastActivityAt: 1 })),
        activeSessionId: 's-a',
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
    app = await launchApp(fake.env, { userDataDir: profile })
    await app.evaluate(({ Notification }) => {
      const g = globalThis as unknown as { __shown: Shown[]; __notes: Electron.Notification[] }
      g.__shown = []
      g.__notes = []
      Notification.prototype.show = function (this: Electron.Notification) {
        g.__shown.push({ title: this.title, body: this.body })
        g.__notes.push(this)
      }
    })
    page = await app.firstWindow()
    await expect(row('s-a')).toBeVisible(WITHIN)
    // Agents start when first viewed: open each once, then come back to s-a.
    for (const id of ['s-a', 's-b', 's-c', 's-a'] as const) {
      await row(id).click()
      await expect.poll(agents[id].pid, WITHIN).not.toBeNull()
    }
    await expect(row('s-a')).toHaveAttribute('aria-current', 'true')
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    for (const agent of Object.values(agents)) if (alive(agent.pid())) process.kill(agent.pid() as number, 'SIGTERM')
  })

  test('a background permission request notifies with project · title and badges the Dock', async () => {
    expect(await badge()).toBe('')
    agents['s-b'].step({ hook: 'UserPromptSubmit', payload: { prompt: '修一下导航' } })
    agents['s-b'].step({ hook: 'PreToolUse', payload: { tool_name: 'Bash', tool_input: { command: 'pnpm test nav' } } })
    agents['s-b'].step({ hook: 'Notification', payload: { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' } })
    await expect(row('s-b').getByRole('img', { name: '等你处理' })).toBeVisible(WITHIN)
    await expect.poll(shown, WITHIN).toHaveLength(1)
    expect((await shown())[0]).toEqual({ title: 'proj-b · 修复导航抖动', body: '等你处理 · 等你确认：运行 pnpm test nav' })
    await expect.poll(badge).toBe('1')
  })

  test('clicking it with the window hidden brings the window back on that session', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    await expect.poll(isVisible).toBe(false)
    await clickNotification(0)
    await expect.poll(isVisible).toBe(true)
    await expect(row('s-b')).toHaveAttribute('aria-current', 'true', WITHIN)
    // Answered in the TUI: the tool runs, nothing needs the user any more.
    agents['s-b'].step({ hook: 'PostToolUse', payload: { tool_name: 'Bash', tool_input: { command: 'pnpm test nav' }, tool_response: {} } })
    await expect(row('s-b').getByRole('img', { name: '运行中' })).toBeVisible(WITHIN)
    await expect.poll(badge).toBe('')
  })

  test('two turns finishing together give one notification that opens the overview', async () => {
    for (const id of ['s-a', 's-c'] as const) {
      agents[id].step({ hook: 'UserPromptSubmit', payload: { prompt: '继续' } })
      agents[id].step({ hook: 'Stop', payload: {} })
    }
    await expect(row('s-a').getByRole('img', { name: '已完成' })).toBeVisible(WITHIN)
    await expect(row('s-c').getByRole('img', { name: '已完成' })).toBeVisible(WITHIN)
    await expect.poll(shown, WITHIN).toHaveLength(2)
    const merged = (await shown())[1]
    expect(merged?.title).toBe('2 个会话已完成')
    expect(merged?.body.split('、').sort()).toEqual(['proj-a · Cookie 迁移', 'proj-c · 图谱布局'])
    await expect.poll(badge).toBe('2')

    await clickNotification(1)
    await expect(page.locator('[data-region="overview"]')).toBeVisible(WITHIN)
  })
})
