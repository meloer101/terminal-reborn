// Checks before a terminal process is started (phase 2a · A8).
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** Prefix of the error message for a missing directory; the renderer's launch-issues.ts parses it. */
export const CWD_MISSING_CODE = 'TR_CWD_MISSING'

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Refuses a working directory that does not exist. The pty-host would quietly start in the home directory,
 * where an agent would then work (and Codex would trust) the wrong folder.
 */
export function assertCwdExists(cwd: string, home: string = homedir(), exists: (path: string) => boolean = isDirectory): void {
  let path = cwd
  if (path === '~') path = home
  else if (path.startsWith('~/')) path = join(home, path.slice(2))
  if (!isAbsolute(path) || !exists(path)) throw new Error(`${CWD_MISSING_CODE}:${cwd}`)
}
