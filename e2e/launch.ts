import { _electron as electron, type ElectronApplication } from '@playwright/test'
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
 */
export function launchApp(
  envOverrides: Record<string, string | undefined> = {},
  options: { userDataDir?: string; args?: string[] } = {}
): Promise<ElectronApplication> {
  // A fixed `userDataDir` lets a test relaunch with the same profile (persistence).
  const userData = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'tr-e2e-'))
  const env: Record<string, string | undefined> = {
    ...process.env,
    TR_USER_DATA_DIR: userData,
    TR_E2E_DIALOGS: '1',
    TR_KILL_SESSIONS_ON_QUIT: '1',
    ...envOverrides
  }
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key]
  return electron.launch({ args: ['.', ...(options.args ?? [])], env: env as Record<string, string> })
}
