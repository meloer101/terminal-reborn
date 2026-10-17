// The account's full name for the welcome greeting (PRD F18). macOS keeps it in the directory service; `id -F`
// prints it. Anything else (or a failure) answers '' and the greeting goes without a name — the short login name
// ("m") reads worse than no name at all.
import { execFile } from 'node:child_process'
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'

const TIMEOUT_MS = 2000
const MAX_LENGTH = 64

/** First line of `id -F`, trimmed; '' for empty or implausibly long output. */
export function cleanFullName(output: string): string {
  const name = output.split('\n')[0]?.trim() ?? ''
  return name.length <= MAX_LENGTH ? name : ''
}

let cached: Promise<string> | null = null

export function userFullName(): Promise<string> {
  cached ??= new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve('')
    execFile('/usr/bin/id', ['-F'], { timeout: TIMEOUT_MS }, (error, stdout) => resolve(error ? '' : cleanFullName(stdout)))
  })
  return cached
}

export function registerUserName(): void {
  ipcMain.handle(IPC.appUserName, () => userFullName())
}
