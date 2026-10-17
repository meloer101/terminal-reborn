// A reopened terminal paints its last screen at once from the saved snapshot, before its process starts again.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

interface Hook {
  readScreen(sessionId: string, scrollbackLines?: number): string
}
const SESSION = 's-shell'
const MARK = 'RESTORE-MARK-42'

test.describe.configure({ mode: 'serial' })

test.describe('terminal snapshots', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-restore-'))
  const project = mkdtempSync(join(tmpdir(), 'tr-e2e-restore-proj-'))
  let app: ElectronApplication
  let page: Page

  const screen = () =>
    page.evaluate(
      (id) => (globalThis as unknown as { __trTerminals?: Hook }).__trTerminals?.readScreen(id, 200) ?? '',
      SESSION
    )

  /** Opens the app on the fixed profile with screen reading on (persistence stays on). */
  const launch = async () => {
    app = await launchApp({}, { userDataDir: profile })
    page = await app.firstWindow()
    await page.addInitScript(() => {
      ;(globalThis as unknown as { __TR_TERMINAL_PROBE__: boolean }).__TR_TERMINAL_PROBE__ = true
    })
    await page.reload()
    await expect(page.locator('[data-region="sidebar"]')).toBeVisible()
  }

  test.beforeAll(() => {
    mkdirSync(profile, { recursive: true })
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'restore-proj', rootPath: project }],
        worktrees: [{ id: 'w1', projectId: 'p1', branch: '', path: project, isMain: true }],
        sessions: [{ id: SESSION, worktreeId: 'w1', kind: 'shell', title: 'Shell', startedAt: 1, lastActivityAt: 1 }],
        activeSessionId: SESSION,
        sidebarCollapsed: false,
        rightPanel: null,
        drafts: {}
      })
    )
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
  })

  test('the screen is saved on quit and painted right away on the next launch', async () => {
    await launch()
    await page.locator(`[data-region="terminal"] [data-session-id="${SESSION}"]`).click()
    // zsh drops keys typed before its line editor is up; wait for the prompt.
    await expect.poll(async () => (await screen()).trim().length, { timeout: 10_000 }).toBeGreaterThan(0)
    await page.keyboard.type(`echo RESTORE-MARK-$((6*7))`)
    await page.keyboard.press('Enter')
    await expect.poll(screen).toContain(MARK)
    await app.close()
    expect(existsSync(join(profile, 'terminal-snapshots', `${SESSION}.json`))).toBe(true)

    await launch()
    const started = Date.now()
    await expect.poll(screen, { intervals: [20] }).toContain(MARK)
    // Far below the time a login shell (let alone `claude --resume`) needs to draw anything.
    expect(Date.now() - started).toBeLessThan(1500)
  })
})
