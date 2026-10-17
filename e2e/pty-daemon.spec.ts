// The pty daemon keeps terminals running across quit: the relaunched app reattaches to the same process (same pid),
// shows its live screen (here a full-screen program on the alternate screen) at once, and input reaches it.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

interface Hook {
  readScreen(sessionId: string, scrollbackLines?: number): string
}
const SESSION = 's-daemon'

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

test.describe('pty daemon', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-daemon-'))
  const project = mkdtempSync(join(tmpdir(), 'tr-e2e-daemon-proj-'))
  let app: ElectronApplication
  let page: Page

  const screen = () =>
    page.evaluate(
      (id) => (globalThis as unknown as { __trTerminals?: Hook }).__trTerminals?.readScreen(id, 50) ?? '',
      SESSION
    )

  const type = async (text: string) => {
    await page.keyboard.type(text)
    await page.keyboard.press('Enter')
  }

  /** Opens the app on the fixed profile; quitting it leaves the sessions running. */
  const launch = async () => {
    app = await launchApp({ TR_KILL_SESSIONS_ON_QUIT: undefined }, { userDataDir: profile })
    page = await app.firstWindow()
    await page.addInitScript(() => {
      ;(globalThis as unknown as { __TR_TERMINAL_PROBE__: boolean }).__TR_TERMINAL_PROBE__ = true
    })
    await page.reload()
    await expect(page.locator('[data-region="sidebar"]')).toBeVisible()
  }

  const daemonPid = (): number => (JSON.parse(readFileSync(join(profile, 'daemon', 'daemon.json'), 'utf8')) as { pid: number }).pid

  test.beforeAll(() => {
    mkdirSync(profile, { recursive: true })
    writeFileSync(
      join(profile, 'workspace.json'),
      JSON.stringify({
        version: 2,
        projects: [{ id: 'p1', name: 'daemon-proj', rootPath: project }],
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
    // Never leave the daemon (and its shell) behind: SIGTERM ends its sessions and it.
    try {
      process.kill(daemonPid(), 'SIGTERM')
    } catch {
      // Already gone.
    }
  })

  test('quitting leaves the shell running; the relaunch reattaches to the same process', async () => {
    await launch()
    await page.locator(`[data-region="terminal"] [data-session-id="${SESSION}"]`).click()
    await type('echo PID-$$-END')
    await expect.poll(screen).toMatch(/PID-\d+-END/)
    const pid = Number(/PID-(\d+)-END/.exec(await screen())?.[1])
    expect(pid).toBeGreaterThan(0)

    // A full-screen program on the alternate screen, waiting for input.
    await type(`printf '\\033[?1049h\\033[2J\\033[HALT-%s-SCREEN\\r\\n' $((6*7)); cat`)
    await expect.poll(screen).toContain('ALT-42-SCREEN')

    await app.close()
    expect(alive(pid)).toBe(true)
    expect(alive(daemonPid())).toBe(true)

    await launch()
    const started = Date.now()
    await expect.poll(screen, { intervals: [20] }).toContain('ALT-42-SCREEN')
    // Far below what a new login shell needs to draw anything.
    expect(Date.now() - started).toBeLessThan(1500)

    // The same `cat` gets our input...
    await page.locator(`[data-region="terminal"] [data-session-id="${SESSION}"]`).click()
    await type('typed-after-relaunch')
    await expect.poll(screen).toContain('typed-after-relaunch')
    // ...and the shell under it is the one from before the quit.
    await page.keyboard.press('Control+C')
    await type(`printf '\\033[?1049l'; echo AGAIN-$$-END`)
    await expect.poll(screen).toContain(`AGAIN-${pid}-END`)
  })
})
