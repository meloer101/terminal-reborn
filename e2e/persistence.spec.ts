// Workspace persistence across relaunches (phase 2 · A2, A12), on a fixed temp profile.
// The workspace is seeded on disk (the fixture flag would switch persistence off), then changed through the UI.
// No model is ever called: the restored Claude session is only started with a made-up conversation id,
// which `claude --resume` rejects immediately.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const CONVERSATION = 'e2e-resume-0001'
const STARTED_AT = 1_700_000_000_000

function outerClaudeEnv(): Record<string, undefined> {
  const strip: Record<string, undefined> = {}
  for (const key of Object.keys(process.env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_') || key.startsWith('CLAUDE_AGENT_')) strip[key] = undefined
  }
  return strip
}

const readJson = (path: string): Record<string, any> => JSON.parse(readFileSync(path, 'utf8')) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Command lines of every running process: the login shell that runs the agent carries its argv. */
function processLines(): string {
  return execFileSync('ps', ['-axo', 'args'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}
const resumeRunning = () => processLines().includes(`'--resume' '${CONVERSATION}'`)

test.describe.configure({ mode: 'serial' })

test.describe('workspace persistence', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-persist-'))
  const project = mkdtempSync(join(tmpdir(), 'tr-e2e-project-'))
  const workspaceFile = join(profile, 'workspace.json')
  const windowFile = join(profile, 'window-state.json')
  let app: ElectronApplication
  let page: Page

  const composer = () => page.getByRole('textbox', { name: '输入框' })
  const row = (id: string) => page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`)
  const launch = async () => {
    app = await launchApp(outerClaudeEnv(), { userDataDir: profile })
    page = await app.firstWindow()
    await expect(page.locator('[data-region="sidebar"]')).toBeVisible()
  }

  test.beforeAll(() => {
    mkdirSync(profile, { recursive: true })
    writeFileSync(
      workspaceFile,
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'persist-proj', rootPath: project }],
        worktrees: [{ id: 'w1', projectId: 'p1', branch: '', path: project, isMain: true }],
        sessions: [
          { id: 's-shell', worktreeId: 'w1', kind: 'shell', title: 'Persisted shell', startedAt: STARTED_AT, lastActivityAt: STARTED_AT },
          { id: 's-claude', worktreeId: 'w1', kind: 'claude', title: 'Persisted Claude', agentSessionId: CONVERSATION, startedAt: STARTED_AT, lastActivityAt: STARTED_AT }
        ],
        activeSessionId: 's-shell',
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
  })

  test.afterEach(async () => {
    await app?.close().catch(() => {})
  })

  test('first launch shows the saved sessions; the Claude session is not started until it is viewed', async () => {
    await launch()
    await expect(row('s-shell')).toContainText('Persisted shell')
    await expect(row('s-claude')).toContainText('Persisted Claude')
    // Only the active (shell) session has a terminal; the Claude session has not been spawned.
    await expect(page.locator('[data-session-id="s-shell"][data-active="true"]')).toBeVisible()
    await page.waitForTimeout(1500)
    expect(resumeRunning()).toBe(false)

    // A draft, a window move, then a second session viewed: all of it reaches disk.
    await composer().fill('草稿 A：别丢')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ x: 80, y: 90, width: 1100, height: 720 }))
    await expect.poll(() => readJson(workspaceFile).drafts?.['s-shell'], { timeout: 5000 }).toBe('草稿 A：别丢')
    await expect.poll(() => (existsSync(windowFile) ? readJson(windowFile).bounds : null), { timeout: 5000 }).toMatchObject({ width: 1100, height: 720 })

    // Viewing the Claude session spawns it with --resume <saved id>.
    await row('s-claude').click()
    await expect.poll(resumeRunning, { timeout: 15_000 }).toBe(true)
    await expect(composer()).toHaveValue('')
    await composer().fill('草稿 B')
    await expect.poll(() => readJson(workspaceFile).drafts?.['s-claude'], { timeout: 5000 }).toBe('草稿 B')
    await row('s-shell').click()
    await expect(composer()).toHaveValue('草稿 A：别丢')
    await expect.poll(() => readJson(workspaceFile).activeSessionId, { timeout: 5000 }).toBe('s-shell')

    const saved = readJson(workspaceFile)
    expect(saved.version).toBe(2)
    expect(saved.sessions.map((s: { id: string; startedAt: number; agentSessionId?: string }) => [s.id, s.startedAt, s.agentSessionId])).toEqual([
      ['s-shell', STARTED_AT, undefined],
      ['s-claude', STARTED_AT, CONVERSATION]
    ])
  })

  test('relaunch: workspace, drafts, active session and window bounds survive; agents are not auto-started', async () => {
    await expect.poll(resumeRunning, { timeout: 15_000 }).toBe(false) // the previous run's agent is gone
    await launch()
    await expect(row('s-shell')).toContainText('Persisted shell')
    await expect(row('s-claude')).toContainText('Persisted Claude')
    await expect(page.locator('[data-session-id="s-shell"][data-active="true"]')).toBeVisible()
    await expect(composer()).toHaveValue('草稿 A：别丢')

    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds())
    expect(bounds).toMatchObject({ x: 80, y: 90, width: 1100, height: 720 })

    // The Claude session came back not started: nothing was spawned for it.
    await page.waitForTimeout(1500)
    expect(resumeRunning()).toBe(false)
    // Its draft is still there, and viewing it resumes the saved conversation.
    await row('s-claude').click()
    await expect(composer()).toHaveValue('草稿 B')
    await expect.poll(resumeRunning, { timeout: 15_000 }).toBe(true)
    await page.screenshot({ path: 'test-results/persistence-restored.png' })
    // startedAt did not reset.
    expect(readJson(workspaceFile).sessions[0].startedAt).toBe(STARTED_AT)
  })
})

test('first run migrates the old localStorage workspace once, then stops using it', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-migrate-'))
  const dir = mkdtempSync(join(tmpdir(), 'tr-e2e-legacy-'))
  const file = join(profile, 'workspace.json')

  // Run 1: nothing stored yet; plant the old keys in the renderer's localStorage.
  let app = await launchApp(outerClaudeEnv(), { userDataDir: profile })
  let page = await app.firstWindow()
  await page.evaluate((root) => {
    localStorage.setItem(
      'tr.workspace.v1',
      JSON.stringify({
        projects: [{ id: 'lp', name: 'legacy-proj', rootPath: root }],
        worktrees: [{ id: 'lw', projectId: 'lp', branch: '', path: root, isMain: true }],
        sessions: [{ id: 'ls', worktreeId: 'lw', kind: 'shell', title: 'Legacy shell' }],
        activeSessionId: 'ls'
      })
    )
    localStorage.setItem('tr.composer.drafts.v1', JSON.stringify({ ls: '旧草稿' }))
  }, dir)
  expect(existsSync(file)).toBe(false)
  await app.close()

  // Run 2: migrated into workspace.json.
  app = await launchApp(outerClaudeEnv(), { userDataDir: profile })
  page = await app.firstWindow()
  await expect(page.locator('[data-region="sidebar"] [data-session-id="ls"]')).toContainText('Legacy shell')
  await expect(page.getByRole('textbox', { name: '输入框' })).toHaveValue('旧草稿')
  await expect.poll(() => (existsSync(file) ? readJson(file) : null), { timeout: 5000 }).toMatchObject({
    version: 2,
    activeSessionId: 'ls',
    drafts: { ls: '旧草稿' }
  })
  await app.close()

  // Run 3: served from workspace.json; the old keys are cleaned up and no longer consulted.
  app = await launchApp(outerClaudeEnv(), { userDataDir: profile })
  page = await app.firstWindow()
  await expect(page.locator('[data-region="sidebar"] [data-session-id="ls"]')).toContainText('Legacy shell')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('tr.workspace.v1'))).toBeNull()
  await app.close()
})
