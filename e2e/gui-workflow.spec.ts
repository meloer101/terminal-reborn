// Ultracode in a GUI session (PRD F25, Figma 74) in the built app, against the fake headless Claude of
// src/main/gui/fixtures (no model, no tokens): Ultracode is a switch only the user turns on and it is never remembered;
// a Workflow call asks on its own card with the phases its script declares; once allowed, the card draws the run
// (counts, tokens, a row per phase, the running phase's agents), the sidebar hangs the run and its phases under the
// session, and 停止 stops it. Screenshots in both themes go to test-results/gui-workflow/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { outerClaudeEnv } from './fake-claude'
import { launchApp, setWindowSize } from './launch'

const SHOTS = join(process.cwd(), 'test-results', 'gui-workflow')
const WITHIN = { timeout: 20_000 }
const FAKE = join(process.cwd(), 'src', 'main', 'gui', 'fixtures', 'fake-claude.mjs')

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

test.describe('F25 ultracode in a GUI session (Claude)', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tr-e2e-wf-')))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  const project = join(root, 'demo')
  const profile = join(root, 'profile')
  for (const dir of [bin, zdot, project, profile]) mkdirSync(dir)
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\n`)

  let app: ElectronApplication
  let page: Page
  const composer = () => page.getByTestId('gui-composer')
  const input = () => composer().getByRole('textbox', { name: '回复' })
  const theme = async (t: 'dark' | 'light') => {
    await page.evaluate((v) => (globalThis as unknown as { tr: { settings: { update(p: unknown): Promise<unknown> } } }).tr.settings.update({ appearance: { theme: v } }), t)
    await expect(page.locator('html')).toHaveAttribute('data-theme', t)
    await page.waitForTimeout(300)
  }
  const shoot = async (name: string) => {
    for (const t of ['dark', 'light'] as const) {
      await theme(t)
      await page.screenshot({ path: join(SHOTS, `${name}-${t}.png`) })
    }
    await theme('dark')
  }

  test.beforeAll(async () => {
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'acme-web', rootPath: project }],
        worktrees: [{ id: 'w-main', projectId: 'p1', branch: 'main', path: project, isMain: true }],
        sessions: [{ id: 's1', worktreeId: 'w-main', kind: 'claude', ui: 'gui', title: 'Auth 迁到 cookie', startedAt: 1, lastActivityAt: 1 }],
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

  test('Ultracode is a named switch the user turns on, never remembered as a pick (Figma 74A)', async () => {
    const ultracode = composer().getByRole('button', { name: 'Ultracode' })
    await expect(ultracode).toHaveAttribute('aria-pressed', 'false', WITHIN)
    await ultracode.click()
    // Read back from Claude's get_settings after the set.
    await expect(ultracode).toHaveAttribute('aria-pressed', 'true', WITHIN)
    await page.waitForTimeout(500)
    const saved = JSON.parse(readFileSync(join(profile, 'workspace.json'), 'utf8')) as { guiPicks?: Record<string, Record<string, unknown>> }
    expect(saved.guiPicks?.claude?.ultracode).toBeUndefined()
  })

  test('a Workflow call asks on its own card, with the phases its script declares (Figma 74A)', async () => {
    await input().fill('run a workflow')
    await input().press('Enter')
    const ask = page.getByTestId('gui-workflow-ask')
    await expect(ask).toBeVisible(WITHIN)
    await expect(ask).toContainText('auth-cookie-migration')
    await expect(ask).toContainText('等你确认')
    for (const phase of ['调研', '改写', '核对']) await expect(ask).toContainText(phase)
    // Asked on the card, not in the card over the composer.
    await expect(page.getByTestId('gui-permission')).toHaveCount(0)
    await shoot('ask')
  })

  test('once allowed, the card draws the run and the sidebar hangs it under the session (Figma 74B / 74D)', async () => {
    await page.getByTestId('gui-workflow-ask').getByRole('button', { name: '运行' }).click()
    const card = page.getByTestId('gui-workflow')
    await expect(card).toBeVisible(WITHIN)
    await expect(card).toContainText('412k tokens')
    await expect(card).toContainText('2 / 6')
    await expect(card).toContainText('刷新 · 过期前续期')
    await expect(card).toContainText('排队')
    await expect(card.getByRole('button', { name: '停止' })).toBeVisible()
    const row = page.getByTestId('workflow-row')
    await expect(row).toContainText('auth-cookie-migration', WITHIN)
    await expect(row).toContainText('2 / 6')
    await expect(page.getByTestId('phase-row')).toHaveCount(3)
    await shoot('running')
    // The run's row folds its phases.
    await row.click()
    await expect(page.getByTestId('phase-row')).toHaveCount(0)
    await row.click()
    await expect(page.getByTestId('phase-row')).toHaveCount(3)
  })

  test('停止 stops the run (stop_task): agents cut off by it are stopped, not failed (Figma 74C)', async () => {
    const card = page.getByTestId('gui-workflow')
    await card.getByRole('button', { name: '停止' }).click()
    await expect(card).toHaveAttribute('data-outcome', 'stopped', WITHIN)
    await expect(card).toContainText('已停止')
    await expect(card).toContainText('431k tokens')
    await expect(card).not.toContainText('出错')
    await shoot('stopped')
  })
})
