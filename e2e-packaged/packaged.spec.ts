// Launch check for the packaged app: pty-host forks, node-pty spawns, the hook script is found in
// Contents/Resources/hooks and runs, and a Claude session starts (launch only, no prompts, then quit).
// Build first:  npx electron-vite build && npx electron-builder --mac --arm64 --dir --publish never
// Run:          npm run test:packaged   (TR_PACKAGED_APP=/path/to/Terminal\ Reborn.app to override)
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version
const appBundle =
  process.env.TR_PACKAGED_APP ?? join('release', version, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Wavi.app')
const executable = join(appBundle, 'Contents', 'MacOS', 'Wavi')
const LAB = '/tmp/tr-hooks-lab'

interface Hooks {
  tr: { agent: { onEvent(listener: (event: unknown) => void): void } }
  __trTerminals: { readScreen(id: string, scrollback?: number): string }
  __trWorkspace: { getState(): { addProject(path: string): string; addSession(projectId: string, kind: 'claude' | 'shell'): string | null } }
  __trSeen: { events: Array<{ sessionId: string; event: { type: string } }> }
}

/** The agent PTYs inherit the app's env; keep this suite's own Claude Code session out of it. */
function cleanEnv(userData: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_') || key.startsWith('CLAUDE_AGENT_')) continue
    env[key] = value
  }
  env.TR_USER_DATA_DIR = userData
  env.TR_DISABLE_UPDATE_CHECK = '1' // no background network call from the test run
  // Auto-answer native dialogs: the fixture workspace has running sessions, so quitting asks first.
  env.TR_E2E_DIALOGS = '1'
  return env
}

function ensureLab(): void {
  mkdirSync(`${LAB}/.claude`, { recursive: true })
  if (!existsSync(`${LAB}/.git`)) {
    execFileSync('git', ['init', '-q'], { cwd: LAB })
    writeFileSync(`${LAB}/README.md`, '# hooks lab\n')
    execFileSync('git', ['add', '.'], { cwd: LAB })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: LAB })
  }
}

function claudeInstalled(): boolean {
  try {
    return execFileSync('/bin/zsh', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim() !== ''
  } catch {
    return false
  }
}

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  expect(existsSync(executable), `build the app first (${executable})`).toBe(true)
  app = await electron.launch({ executablePath: executable, args: [], env: cleanEnv(mkdtempSync(join(tmpdir(), 'tr-packaged-'))) })
  page = await app.firstWindow()
  await page.addInitScript(() => {
    const g = globalThis as unknown as Hooks & { __TR_E2E__: boolean }
    g.__TR_E2E__ = true
    g.__trSeen = { events: [] }
    g.tr.agent.onEvent((e) => g.__trSeen.events.push(e as Hooks['__trSeen']['events'][number]))
  })
  await page.reload()
})

test.afterAll(async () => {
  await app?.close()
})

const screen = (id: string) => page.evaluate((s) => (globalThis as unknown as Hooks).__trTerminals.readScreen(s, 2000), id)

test('is the packaged build with the right version and resources', async () => {
  await expect(page).toHaveTitle('Wavi')
  const info = await app.evaluate(({ app: electronApp }) => ({
    packaged: electronApp.isPackaged,
    version: electronApp.getVersion(),
    resources: process.resourcesPath,
    arch: process.arch
  }))
  expect(info.packaged).toBe(true)
  expect(info.version).toBe(version)
  const hook = join(info.resources, 'hooks', 'tr-hook.sh')
  expect(() => accessSync(hook, constants.X_OK)).not.toThrow()
  const helper = join(info.resources, 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds', `darwin-${info.arch}`, 'spawn-helper')
  expect(() => accessSync(helper, constants.X_OK)).not.toThrow()
  for (const region of ['sidebar', 'main', 'terminal']) await expect(page.locator(`[data-region="${region}"]`)).toBeVisible()
})

test('the update check resolves without throwing (null while the repo has no newer release)', async () => {
  const result = await page.evaluate(async () => {
    const api = (globalThis as unknown as { tr: { app: { version: string; checkForUpdates(): Promise<{ version: string } | null> } } }).tr.app
    return { version: api.version, update: await api.checkForUpdates() }
  })
  expect(result.version).toBe(version)
  // The live repo may legitimately have a newer release by the time this runs; only the shape matters.
  expect(result.update === null || typeof result.update.version === 'string').toBe(true)
})

test('a shell session runs through pty-host and node-pty', async () => {
  const id = await page.evaluate(() => {
    const ws = (globalThis as unknown as Hooks).__trWorkspace.getState()
    return ws.addSession(ws.addProject('/tmp'), 'shell') ?? ''
  })
  expect(id).not.toBe('')
  const pane = page.locator(`[data-region="terminal"] [data-session-id="${id}"]`)
  await expect(pane).toBeVisible()
  await pane.click()
  await page.waitForTimeout(1500)
  await page.keyboard.type('echo packaged-$((6*7))')
  await page.keyboard.press('Enter')
  await expect.poll(() => screen(id), { timeout: 20_000, intervals: [300] }).toMatch(/^packaged-42$/m)
})

test('a Claude session starts and its hooks arrive (launch only, no prompts)', async () => {
  test.skip(!claudeInstalled(), 'claude CLI not installed')
  ensureLab()
  const id = await page.evaluate((root) => {
    const ws = (globalThis as unknown as Hooks).__trWorkspace.getState()
    return ws.addSession(ws.addProject(root), 'claude') ?? ''
  }, LAB)
  expect(id).not.toBe('')
  await expect.poll(() => screen(id), { timeout: 60_000, intervals: [500] }).toMatch(/\? for shortcuts|manual mode|auto mode|Yes, I trust/)
  await expect
    .poll(() => page.evaluate(() => (globalThis as unknown as Hooks).__trSeen.events.map((e) => e.event.type)), { timeout: 30_000 })
    .toContain('session-start')
})
