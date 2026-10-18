// The profile directory (userData: workspace, settings, snapshots, the pty daemon's socket). Release and linked
// builds use `<appData>/Wavi`; a dev run uses `<appData>/Wavi Dev`, so `npm run dev` in any worktree never takes
// the installed app's single-instance lock, daemon or workspace. Until v0.1.x the app was "Terminal Reborn": its
// profile is renamed to Wavi on the first launch that finds nothing still running from it (a live pty daemon or
// app instance keeps the old directory in use for that run, so no terminal is cut off).
import { app } from 'electron'
import { existsSync, readFileSync, readlinkSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export const LEGACY_PROFILE_NAME = 'Terminal Reborn'

export interface ProfileInput {
  appData: string
  /** The app's name (`productName`). */
  name: string
  packaged: boolean
  /** TR_USER_DATA_DIR: e2e runs use a throwaway profile. */
  override?: string | undefined
  exists(path: string): boolean
  /** Something still runs from this profile (its pty daemon or an app instance). */
  inUse(dir: string): boolean
}

export interface ProfilePlan {
  dir: string
  /** Rename this directory to `dir` first. */
  migrateFrom?: string
}

export function planProfile(input: ProfileInput): ProfilePlan {
  if (input.override) return { dir: input.override }
  if (!input.packaged) return { dir: join(input.appData, `${input.name} Dev`) }
  const dir = join(input.appData, input.name)
  const legacy = join(input.appData, LEGACY_PROFILE_NAME)
  if (input.name === LEGACY_PROFILE_NAME || input.exists(dir) || !input.exists(legacy)) return { dir }
  if (input.inUse(legacy)) return { dir: legacy }
  return { dir, migrateFrom: legacy }
}

/** `daemon/daemon.json` (src/pty-daemon): `{ pid, ... }`. */
export function pidFromDaemonRecord(text: string): number | null {
  try {
    const pid: unknown = (JSON.parse(text) as { pid?: unknown }).pid
    return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/** Chromium's `SingletonLock` symlink points at `<hostname>-<pid>`. */
export function pidFromSingletonLock(target: string): number | null {
  const match = /-(\d+)$/.exec(target)
  const pid = match ? Number(match[1]) : NaN
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

function alive(pid: number | null): boolean {
  if (pid === null || pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function profileInUse(dir: string): boolean {
  let daemonPid: number | null = null
  let appPid: number | null = null
  try {
    daemonPid = pidFromDaemonRecord(readFileSync(join(dir, 'daemon', 'daemon.json'), 'utf8'))
  } catch {
    // No daemon record: none ran, or it cleaned up.
  }
  try {
    appPid = pidFromSingletonLock(readlinkSync(join(dir, 'SingletonLock')))
  } catch {
    // No lock: no instance.
  }
  return alive(daemonPid) || alive(appPid)
}

/** Picks (and if needed migrates) the profile. Call before anything reads userData, the single-instance lock included. */
export function selectProfile(): void {
  const plan = planProfile({
    appData: app.getPath('appData'),
    name: app.getName(),
    packaged: app.isPackaged,
    override: process.env.TR_USER_DATA_DIR,
    exists: existsSync,
    inUse: profileInUse
  })
  if (plan.migrateFrom) {
    try {
      renameSync(plan.migrateFrom, plan.dir)
    } catch (error) {
      console.error('[main] could not move the old profile; using it in place this run:', error)
      app.setPath('userData', plan.migrateFrom)
      return
    }
  }
  app.setPath('userData', plan.dir)
}
