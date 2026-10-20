// Several things waiting on the user at once, through the real hook path (fake `claude` running its per-launch hooks
// → socket → pty daemon → main → renderer; PRD §3.1). Until 2026-10-20 two dialogs up at once overwrote each other:
// answering the first turned the session back to 运行中 while the second was still on screen. A subagent's or a
// background agent's calls (`agent_id`, Claude 2.1.304) never move the main turn; only their dialogs count.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { alive, fakeHookClaude } from './fake-hook-claude'
import { launchApp } from './launch'

const WITHIN = { timeout: 20_000 }

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('asks', () => {
  const fake = fakeHookClaude('tr-e2e-asks-')
  const agents = { 's-a': fake.folder('proj-a'), 's-b': fake.folder('proj-b') }
  const profile = join(fake.root, 'profile')
  let app: ElectronApplication
  let page: Page

  const row = (id: string) => page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`)
  const status = (id: string, name: string) => row(id).getByRole('img', { name })
  const b = agents['s-b']
  const fetchA = { tool_name: 'WebFetch', tool_input: { url: 'https://a.example', prompt: 'x' } }
  const fetchB = { tool_name: 'WebFetch', tool_input: { url: 'https://b.example', prompt: 'x' } }

  test.beforeAll(async () => {
    mkdirSync(profile, { recursive: true })
    const ids = Object.keys(agents) as (keyof typeof agents)[]
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: ids.map((id) => ({ id: `p-${id}`, name: agents[id].path.split('/').at(-1), rootPath: agents[id].path })),
        worktrees: ids.map((id) => ({ id: `w-${id}`, projectId: `p-${id}`, branch: '', path: agents[id].path, isMain: true })),
        sessions: ids.map((id) => ({ id, worktreeId: `w-${id}`, kind: 'claude', title: `会话 ${id}`, startedAt: 1, lastActivityAt: 1 })),
        activeSessionId: 's-a',
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
    app = await launchApp(fake.env, { userDataDir: profile })
    page = await app.firstWindow()
    // Agents start when first viewed; s-b then runs in the background, unseen.
    for (const id of ['s-b', 's-a'] as const) {
      await row(id).click()
      await expect.poll(agents[id].pid, WITHIN).not.toBeNull()
    }
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    for (const agent of Object.values(agents)) if (alive(agent.pid())) process.kill(agent.pid() as number, 'SIGTERM')
  })

  test('two dialogs of one batch: answering the first keeps 等你处理 until the second is answered', async () => {
    b.step({ hook: 'UserPromptSubmit', payload: { prompt: '查两个网站' } })
    b.step({ hook: 'PreToolUse', payload: { ...fetchA, tool_use_id: 't1' } })
    b.step({ hook: 'PreToolUse', payload: { ...fetchB, tool_use_id: 't2' } })
    b.step({ hook: 'PermissionRequest', payload: fetchA })
    b.step({ hook: 'PermissionRequest', payload: fetchB })
    await expect(status('s-b', '等你处理')).toBeVisible(WITHIN)
    await expect(row('s-b')).toContainText('等你确认：抓取 a.example（共 2 项）')

    b.step({ hook: 'PostToolUse', payload: { ...fetchA, tool_use_id: 't1', tool_response: {} } })
    await expect(row('s-b')).toContainText('等你确认：抓取 b.example', WITHIN)
    await expect(status('s-b', '等你处理')).toBeVisible()

    b.step({ hook: 'PostToolUse', payload: { ...fetchB, tool_use_id: 't2', tool_response: {} } })
    await expect(status('s-b', '运行中')).toBeVisible(WITHIN)
  })

  test('a subagent working after the turn ended leaves 已完成 alone; its dialog is 等你处理, then 已完成 again', async () => {
    b.step({ hook: 'Stop', payload: { last_assistant_message: '两个网站都查好了。', background_tasks: [{ id: 'bg1', type: 'local_agent', status: 'running' }] } })
    await expect(status('s-b', '已完成')).toBeVisible(WITHIN)

    const sub = { agent_id: 'bg1', agent_type: 'general-purpose' }
    const make = { tool_name: 'Bash', tool_input: { command: 'make check' }, ...sub }
    b.step({ hook: 'PreToolUse', payload: { tool_name: 'Read', tool_input: { file_path: '/x/a.ts' }, tool_use_id: 't3', ...sub } })
    b.step({ hook: 'PostToolUse', payload: { tool_name: 'Read', tool_input: { file_path: '/x/a.ts' }, tool_use_id: 't3', tool_response: {}, ...sub } })
    await page.waitForTimeout(1_500)
    await expect(status('s-b', '已完成')).toBeVisible()
    b.step({ hook: 'PreToolUse', payload: { ...make, tool_use_id: 't4' } })
    b.step({ hook: 'PermissionRequest', payload: make })
    await expect(status('s-b', '等你处理')).toBeVisible(WITHIN)
    await expect(row('s-b')).toContainText('等你确认：运行 make check')

    b.step({ hook: 'PostToolUse', payload: { ...make, tool_use_id: 't4', tool_response: {} } })
    await expect(status('s-b', '已完成')).toBeVisible(WITHIN)
    await expect(row('s-b')).toContainText('两个网站都查好了。')
  })
})
