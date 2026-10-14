// Where the hook socket and the generated Claude settings file live (phase 2a · A9). They used to sit in
// $TMPDIR, which macOS cleans periodically; a long-running app would then lose its socket silently.
// Now: <userData>/hooks/<pid>/ (0700). Unix socket paths are limited to 104 bytes on macOS, so a deep userData
// falls back to a short /tmp/tr-<uid>-<rand> directory.
import { randomBytes } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeSocket, SOCKET_NAME } from './server'

/** sockaddr_un.sun_path is 104 bytes including the NUL terminator on macOS. */
export const MAX_SOCKET_PATH_BYTES = 103

/** Socket directories younger than this are never swept: another instance may be between mkdir and listen. */
const MIN_SWEEP_AGE_MS = 10_000

export interface HookDirOptions {
  /** Electron's `app.getPath('userData')`. */
  userData: string
  pid?: number
  uid?: number
  /** Parent for the fallback directory. */
  fallbackRoot?: string
  random?: () => string
}

export function socketFits(dir: string): boolean {
  return Buffer.byteLength(join(dir, SOCKET_NAME)) <= MAX_SOCKET_PATH_BYTES
}

export function userUid(): number {
  return process.getuid?.() ?? 0
}

/** Creates (0700) and returns this run's directory for the socket and settings file. */
export function createHookDir(options: HookDirOptions): string {
  const pid = options.pid ?? process.pid
  const preferred = join(options.userData, 'hooks', String(pid))
  let dir = preferred
  if (!socketFits(preferred)) {
    const random = options.random ?? (() => randomBytes(4).toString('hex'))
    dir = join(options.fallbackRoot ?? '/tmp', `tr-${options.uid ?? userUid()}-${random()}`)
  } else {
    // A leftover directory with our pid (pid reuse after a crash) is stale by definition.
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(join(options.userData, 'hooks'), { recursive: true, mode: 0o700 })
    chmodSync(join(options.userData, 'hooks'), 0o700)
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  return dir
}

export interface SweepOptions {
  userData: string
  /** The directory in use right now; never removed. */
  keep: string
  uid?: number
  /** Where legacy `tr-hooks-*` directories were created (os.tmpdir()). */
  legacyRoot?: string
  fallbackRoot?: string
  now?: number
  minAgeMs?: number
  /** Whether a live server answers on this socket. Default: connect to it. */
  isLive?: (socketPath: string) => Promise<boolean>
}

function candidates(options: SweepOptions): string[] {
  const uid = options.uid ?? userUid()
  const found: string[] = []
  const list = (root: string, accept: (name: string) => boolean): void => {
    let names: string[]
    try {
      names = readdirSync(root)
    } catch {
      return
    }
    for (const name of names) if (accept(name)) found.push(join(root, name))
  }
  list(join(options.userData, 'hooks'), (name) => /^\d+$/.test(name))
  list(options.legacyRoot ?? tmpdir(), (name) => /^tr-hooks-[A-Za-z0-9]+$/.test(name))
  list(options.fallbackRoot ?? '/tmp', (name) => new RegExp(`^tr-${uid}-[0-9a-f]{8}$`).test(name))
  return found
}

/**
 * Removes hook directories left by earlier runs: ours under userData, the legacy `$TMPDIR/tr-hooks-*`, and
 * `/tmp/tr-<uid>-*`. A directory is stale when no server answers on its socket; live ones (another running
 * instance) and fresh ones are kept. Returns the removed directories. Never throws.
 */
export async function sweepStaleHookDirs(options: SweepOptions): Promise<string[]> {
  const uid = options.uid ?? userUid()
  const now = options.now ?? Date.now()
  const minAge = options.minAgeMs ?? MIN_SWEEP_AGE_MS
  const isLive = options.isLive ?? ((path) => probeSocket(path, 500))
  const removed: string[] = []
  for (const dir of candidates(options)) {
    if (dir === options.keep) continue
    try {
      const stat = lstatSync(dir)
      // Only plain directories we own: never follow a symlink someone planted in /tmp.
      if (!stat.isDirectory() || stat.uid !== uid || now - stat.mtimeMs < minAge) continue
      if (await isLive(join(dir, SOCKET_NAME))) continue
      rmSync(dir, { recursive: true, force: true })
      removed.push(dir)
    } catch (error) {
      console.error('[hooks] could not sweep', dir, error)
    }
  }
  return removed
}
