import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Launches the built app with a throwaway profile, so tests never see or change the user's workspace.
 * `options.userDataDir` reuses a profile across launches. `envOverrides` adjusts the app's environment (a `undefined` value removes the variable); agent PTYs
 * inherit it, so e2e runs started from inside Claude Code strip the outer session's markers this way.
 */
export function launchApp(
  envOverrides: Record<string, string | undefined> = {},
  options: { userDataDir?: string } = {}
): Promise<ElectronApplication> {
  // A fixed `userDataDir` lets a test relaunch with the same profile (persistence).
  const userData = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'tr-e2e-'))
  const env: Record<string, string | undefined> = { ...process.env, TR_USER_DATA_DIR: userData, ...envOverrides }
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key]
  return electron.launch({ args: ['.'], env: env as Record<string, string> })
}
