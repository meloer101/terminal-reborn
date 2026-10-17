// Workspace persistence across relaunches (phase 2 · A2, A12), on a fixed temp profile.
// The workspace is seeded on disk (the fixture flag would switch persistence off), then changed through the UI.
// No model is ever called: `claude` is a fake script on a throwaway ZDOTDIR PATH (same trick as
// agent-lifecycle.spec.ts) that stays running, so the resumed launch can be seen in `ps` on any machine.
// A real `claude --resume <made-up id>` exits at once, and on CI there is none: the launch line was gone too soon to see.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

const FAKE_CLAUDE = `#!/bin/sh
printf 'Claude Code v9.9.9 %s\\n' "$*"
while read -r line; do
  [ "$line" = "/exit" ] && exit 0
done
`

/** Login-shell environment whose PATH has the fake `claude` and nothing from the user's rc files. */
function fakeClaudeEnv(): Record<string, string | undefined> {
  const root = mkdtempSync(join(tmpdir(), 'tr-e2e-persist-bin-'))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  for (const dir of [bin, zdot]) mkdirSync(dir)
  writeFileSync(join(bin, 'claude'), FAKE_CLAUDE)
  chmodSync(join(bin, 'claude'), 0o755)
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:/usr/bin:/bin"\n`)
  return { ...outerClaudeEnv(), ZDOTDIR: zdot, SHELL: '/bin/zsh' }
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
  const env = fakeClaudeEnv()
  let app: ElectronApplication
  let page: Page

  const row = (id: string) => page.locator(`[data-region="sidebar"] [data-session-id="${id}"]`)
  const launch = async () => {
    app = await launchApp(env, { userDataDir: profile })
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

    // A window move, then a second session viewed: all of it reaches disk.
    // The bounds fit the display (CI runners have a 1024×768 screen); restoring a window wider than the display
    // clamps it, which would make the relaunch below compare against something it never restores.
    // The OS may still adjust what it is given: compare with what it got.
    const actual = await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const area = screen.getPrimaryDisplay().workArea
      win?.setBounds({ x: area.x + 20, y: area.y + 20, width: Math.min(1100, area.width - 40), height: Math.min(720, area.height - 40) })
      return win?.getBounds()
    })
    await expect.poll(() => (existsSync(windowFile) ? readJson(windowFile).bounds : null), { timeout: 5000 }).toMatchObject({ width: actual?.width, height: actual?.height })

    // Viewing the Claude session resumes it in its terminal with --resume <saved id>, like reopening a tab.
    await row('s-claude').click()
    await expect.poll(resumeRunning, { timeout: 15_000 }).toBe(true)
    await row('s-shell').click()
    await expect.poll(() => readJson(workspaceFile).activeSessionId, { timeout: 5000 }).toBe('s-shell')

    const saved = readJson(workspaceFile)
    expect(saved.version).toBe(2)
    expect(saved.sessions.map((s: { id: string; startedAt: number; agentSessionId?: string }) => [s.id, s.startedAt, s.agentSessionId])).toEqual([
      ['s-shell', STARTED_AT, undefined],
      ['s-claude', STARTED_AT, CONVERSATION]
    ])
  })

  test('relaunch: workspace, active session and window bounds survive; agents start only when viewed', async () => {
    await expect.poll(resumeRunning, { timeout: 15_000 }).toBe(false) // the previous run's agent is gone
    await launch()
    await expect(row('s-shell')).toContainText('Persisted shell')
    await expect(row('s-claude')).toContainText('Persisted Claude')
    await expect(page.locator('[data-session-id="s-shell"][data-active="true"]')).toBeVisible()

    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds())
    // Whatever the previous run saved (the OS may have clamped the requested size) comes back.
    const saved = readJson(windowFile).bounds as { x: number; y: number; width: number; height: number }
    expect(bounds).toMatchObject({ x: saved.x, y: saved.y, width: saved.width, height: saved.height })

    // The Claude session came back not started: nothing was spawned for it.
    await page.waitForTimeout(1500)
    expect(resumeRunning()).toBe(false)
    // Viewing it resumes the saved conversation.
    await row('s-claude').click()
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
