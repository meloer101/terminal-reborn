import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Launches the built app with a throwaway profile, so tests never see or change the user's workspace.
 * `envOverrides` adjusts the app's environment (a `undefined` value removes the variable); agent PTYs
 * inherit it, so e2e runs started from inside Claude Code strip the outer session's markers this way.
 * Confirmation dialogs are recorded in main (`globalThis.__trDialogs`) and auto-answered instead of shown.
 */
export function launchApp(envOverrides: Record<string, string | undefined> = {}): Promise<ElectronApplication> {
  const userData = mkdtempSync(join(tmpdir(), 'tr-e2e-'))
  const env: Record<string, string | undefined> = { ...process.env, TR_USER_DATA_DIR: userData, TR_E2E_DIALOGS: '1', ...envOverrides }
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key]
  return electron.launch({ args: ['.'], env: env as Record<string, string> })
}
