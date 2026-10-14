import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Launches the built app with a throwaway profile, so tests never see or change the user's workspace. */
export function launchApp(): Promise<ElectronApplication> {
  const userData = mkdtempSync(join(tmpdir(), 'tr-e2e-'))
  return electron.launch({ args: ['.'], env: { ...process.env, TR_USER_DATA_DIR: userData } as Record<string, string> })
}
