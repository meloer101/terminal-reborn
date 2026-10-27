// The pty daemon keeps terminals running across quit: the relaunched app reattaches to the same process (same pid),
// shows its live screen (here a full-screen program on the alternate screen) at once, and input reaches it.
// A SIGTERM ends the sessions only during a logout, restart or shutdown (PRD §6.8).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
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

function parentPid(pid: number): number {
  return Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim())
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

test.describe('pty daemon', () => {
  const profile = mkdtempSync(join(tmpdir(), 'tr-e2e-daemon-'))
  const project = mkdtempSync(join(tmpdir(), 'tr-e2e-daemon-proj-'))
  let app: ElectronApplication
  let page: Page
  /** The session's shell, kept across the tests. */
  let shellPid = 0

  const screen = () =>
    page.evaluate(
      (id) => (globalThis as unknown as { __trTerminals?: Hook }).__trTerminals?.readScreen(id, 50) ?? '',
      SESSION
    )

  const type = async (text: string) => {
    await page.keyboard.type(text)
    await page.keyboard.press('Enter')
  }

  /**
   * Clicks the terminal and waits until it has the keyboard and the shell has drawn something. A click before xterm is
   * open (fonts loading) does not focus it, and keys typed meanwhile never reach the PTY: on a loaded machine the
   * first characters of `echo PID-$$-END` went missing.
   */
  const focusTerminal = async () => {
    const pane = page.locator(`[data-region="terminal"] [data-session-id="${SESSION}"]`)
    await expect
      .poll(async () => {
        await pane.click()
        return page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea') ?? false)
      })
      .toBe(true)
    // A login shell under load can take seconds to draw its prompt.
    await expect.poll(async () => (await screen()).trim().length, { timeout: 20_000 }).toBeGreaterThan(0)
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
  const daemonLog = (): string => readFileSync(join(profile, 'daemon', 'daemon.log'), 'utf8')

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
    // Never leave the daemon (and its shell) behind. A SIGTERM would keep them; SIGKILL closes the PTYs, which hangs up
    // the shell.
    try {
      process.kill(daemonPid(), 'SIGKILL')
    } catch {
      // Already gone.
    }
  })

  test('quitting leaves the shell running; the relaunch reattaches to the same process', async () => {
    await launch()
    await focusTerminal()
    await type('echo PID-$$-END')
    await expect.poll(screen).toMatch(/PID-\d+-END/)
    const pid = Number(/PID-(\d+)-END/.exec(await screen())?.[1])
    expect(pid).toBeGreaterThan(0)
    shellPid = pid

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
    await focusTerminal()
    await type('typed-after-relaunch')
    await expect.poll(screen).toContain('typed-after-relaunch')
    // ...and the shell under it is the one from before the quit.
    await page.keyboard.press('Control+C')
    await type(`printf '\\033[?1049l'; echo AGAIN-$$-END`)
    await expect.poll(screen).toContain(`AGAIN-${pid}-END`)
  })

  test('a SIGTERM keeps the daemon and its shell; during a logout it ends them', async () => {
    const daemon = daemonPid()
    // Orphaned from the start: stopping the app's process tree (a tool walking parent pids) never reaches it.
    expect(parentPid(daemon)).toBe(1)

    await app.close()
    process.kill(daemon, 'SIGTERM')
    await expect.poll(daemonLog).toContain('SIGTERM outside a logout or shutdown: keeping 1 running sessions')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(alive(daemon)).toBe(true)
    expect(alive(shellPid)).toBe(true)

    // The relaunch reattaches the same shell.
    await launch()
    expect(daemonPid()).toBe(daemon)
    await focusTerminal()
    await type('echo STILL-$$-END')
    await expect.poll(screen).toContain(`STILL-${shellPid}-END`)

    // Logout, restart or shutdown (powerMonitor `shutdown`): main tells the daemon, and now a SIGTERM ends the sessions.
    await app.evaluate(({ powerMonitor }) => {
      powerMonitor.emit('shutdown')
    })
    await expect.poll(daemonLog).toContain('the system is logging out, restarting or shutting down')
    process.kill(daemon, 'SIGTERM')
    await expect.poll(() => alive(daemon)).toBe(false)
    await expect.poll(() => alive(shellPid)).toBe(false)
    expect(daemonLog()).toContain('shutting down: SIGTERM during logout or shutdown (ending sessions)')
  })
})
