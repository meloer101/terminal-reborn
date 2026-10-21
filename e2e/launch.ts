import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Launches the built app with a throwaway profile, so tests never see or change the user's workspace.
 * `options.userDataDir` reuses a profile across launches; `options.args` adds Chromium switches (e.g. host-resolver-rules). `envOverrides` adjusts the app's environment (a `undefined` value removes the variable); agent PTYs
 * inherit it, so e2e runs started from inside Claude Code strip the outer session's markers this way.
 * Confirmation dialogs are recorded in main (`globalThis.__trDialogs`) and auto-answered instead of shown.
 * Quitting ends every session (and the pty daemon) so no test leaves processes behind; pass
 * `TR_KILL_SESSIONS_ON_QUIT: undefined` to keep them running across a relaunch (e2e/pty-daemon.spec.ts).
 * `options.appDir` launches another build than this checkout's `out/` (a long soak keeps a frozen copy).
 */
export function launchApp(
  envOverrides: Record<string, string | undefined> = {},
  options: { userDataDir?: string; args?: string[]; appDir?: string } = {}
): Promise<ElectronApplication> {
  // A fixed `userDataDir` lets a test relaunch with the same profile (persistence).
  const userData = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'tr-e2e-'))
  const env: Record<string, string | undefined> = {
    ...process.env,
    TR_USER_DATA_DIR: userData,
    TR_E2E_DIALOGS: '1',
    TR_KILL_SESSIONS_ON_QUIT: '1',
    // Never ask the real Claude / Codex account for its plan usage from a test run.
    TR_ACCOUNT_USAGE: 'off',
    // Nor the real gh for PRs (PRD F16); e2e/pull-requests.spec.ts puts a fake one on the PATH instead.
    TR_GH: 'off',
    ...envOverrides
  }
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key]
  return electron.launch({ args: [options.appDir ?? '.', ...(options.args ?? [])], env: env as Record<string, string> })
}

/**
 * Sizes the main window and waits until the page has the new width. macOS fits a window into the screen when it is
 * first shown (the CI runner's is 1024×768), which undoes a size set before that; set once the window is on screen,
 * the width sticks even when it is wider than the screen. So this waits for the window to be visible first.
 */
export async function setWindowSize(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  // The main window: secondary windows (PRD F20 · 多窗口) have no page of their own (about:blank, or nothing yet).
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => /^(file|https?):/.test(w.webContents.getURL()))?.isVisible() ?? false))
    .toBe(true)
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((win) => /^(file|https?):/.test(win.webContents.getURL()))?.setSize(w!, h!),
    [width, height]
  )
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)).toBe(width)
}
