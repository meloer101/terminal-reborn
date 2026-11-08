// An empty GUI session's agent and project (PRD F23, Figma 65B / 65H / 65I), in the built app against the fake
// headless Claude and Codex of src/main/gui/fixtures: before anything is said, the model menu switches the agent and
// the wheel over the project's name moves the session to another project; once a message is sent, neither can change.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { outerClaudeEnv } from './fake-claude'
import { launchApp, setWindowSize } from './launch'

const FIXTURES = join(process.cwd(), 'src', 'main', 'gui', 'fixtures')
const SHOTS = join(process.cwd(), 'test-results', 'gui-switch')
const WITHIN = { timeout: 15_000 }

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('F23 GUI session · switching agent and project before the first message (Figma 65)', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tr-e2e-gui-switch-')))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  const demo = join(root, 'demo')
  const web = join(root, 'web')
  const profile = join(root, 'profile')
  for (const dir of [bin, zdot, demo, web, profile]) mkdirSync(dir)
  for (const [name, fake] of [['claude', 'fake-claude.mjs'], ['codex', 'fake-codex.mjs']] as const) {
    writeFileSync(join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${join(FIXTURES, fake)}" "$@"\n`)
    chmodSync(join(bin, name), 0o755)
  }
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\n`)

  let app: ElectronApplication
  let page: Page
  const composer = () => page.getByTestId('gui-composer')
  const saved = () => JSON.parse(readFileSync(join(profile, 'workspace.json'), 'utf8')) as { sessions: { id: string; kind: string; worktreeId: string; title: string }[] }

  test.beforeAll(async () => {
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [
          { id: 'p1', name: 'demo', rootPath: demo },
          { id: 'p2', name: 'web', rootPath: web }
        ],
        worktrees: [
          { id: 'w-demo', projectId: 'p1', branch: 'main', path: demo, isMain: true },
          { id: 'w-web', projectId: 'p2', branch: 'main', path: web, isMain: true }
        ],
        sessions: [{ id: 's1', worktreeId: 'w-demo', kind: 'claude', ui: 'gui', title: 'Claude Code', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: 's1',
        sidebarCollapsed: false,
        drafts: {}
      })
    )
    app = await launchApp({ ...outerClaudeEnv(), ZDOTDIR: zdot, SHELL: '/bin/zsh', CLAUDE_CONFIG_DIR: join(root, 'claude-config') }, { userDataDir: profile })
    page = await app.firstWindow()
    await setWindowSize(app, page, 1440, 900)
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('the model menu switches the agent: Codex starts, with the session’s title', async () => {
    await expect(composer().locator('[data-picker="model"]')).toHaveText('Opus', WITHIN)
    await composer().locator('[data-picker="model"]').click()
    await page.getByTestId('gui-agent-menu').getByRole('menuitem', { name: 'Codex' }).hover()
    // Codex has not run here before: just its default.
    await page.getByTestId('gui-agent-models').getByRole('menuitemradio', { name: '默认' }).click()
    await expect(composer().locator('[data-picker="model"]')).toHaveText('GPT A', WITHIN)
    await expect(page.locator('[data-region="sidebar"]').getByText('Codex', { exact: true })).toBeVisible()
    await expect.poll(() => saved().sessions[0], WITHIN).toMatchObject({ kind: 'codex', title: 'Codex' })
    // Codex reported its models: switching back to Claude lists Claude's from last time, and back again Codex's.
    await composer().locator('[data-picker="model"]').click()
    await page.getByTestId('gui-agent-menu').getByRole('menuitem', { name: 'Claude Code' }).hover()
    await expect(page.getByTestId('gui-agent-models').getByRole('menuitemradio')).toHaveText(['Opus', 'Haiku'])
    await page.getByTestId('gui-agent-models').getByRole('menuitemradio', { name: 'Haiku' }).click()
    await expect(composer().locator('[data-picker="model"]')).toHaveText('Haiku', WITHIN)
    await expect.poll(() => saved().sessions[0]?.kind, WITHIN).toBe('claude')
  })

  test('the wheel over the project moves the session to another project once it stops (Figma 65I)', async () => {
    const chip = page.getByTestId('gui-project')
    await expect(chip).toHaveText('demo')
    await chip.hover()
    await page.screenshot({ path: join(SHOTS, 'project-hover-dark.png') })
    await page.mouse.wheel(0, 50)
    await expect(chip).toContainText('web')
    await expect.poll(() => saved().sessions[0]?.worktreeId, WITHIN).toBe('w-web')
    // Still Claude, now in web: the agent restarted there.
    await expect(composer().locator('[data-picker="model"]')).toBeVisible(WITHIN)
    await expect(page.getByTestId('gui-project')).toHaveText(/web/)
  })

  test('once a message is sent, the model menu lists only the agent’s models and the welcome is gone', async () => {
    await composer().getByRole('textbox', { name: '回复' }).fill('你好')
    await composer().getByRole('textbox', { name: '回复' }).press('Enter')
    await expect(page.getByTestId('gui-welcome')).toHaveCount(0, WITHIN)
    await composer().locator('[data-picker="model"]').click()
    await expect(page.getByTestId('gui-agent-menu')).toHaveCount(0)
    const menu = page.getByRole('dialog', { name: '模型' })
    await expect(menu).toContainText('Claude Code')
    await expect(menu.getByRole('menuitemradio')).toHaveText(['Opus', 'Haiku'])
    await page.screenshot({ path: join(SHOTS, 'model-menu-locked-dark.png') })
    await page.keyboard.press('Escape')
  })
})
