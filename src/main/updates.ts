// "A newer release exists" (PRD §7, unsigned builds): asks GitHub for the latest release, answers the
// renderer's checkForUpdates(), and shows one notification per new version. It never downloads or
// installs anything; clicking the notification opens the release page.
import { app, ipcMain, Notification, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { IPC, type UpdateInfo } from '@shared/ipc'
import { isDeveloperBuild } from './source-checkout'
import { checkLatestRelease, parseRepository, type FetchLike, type Repo } from './update-check'

const FIRST_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

function repository(): Repo | null {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'))
    return parseRepository(typeof pkg === 'object' && pkg !== null ? (pkg as { repository?: unknown }).repository : undefined)
  } catch {
    return null
  }
}

/** Latest GitHub release if newer than the running app, else null. Never throws. */
export function checkForUpdates(): Promise<UpdateInfo | null> {
  return checkLatestRelease(repository(), app.getVersion(), fetch as FetchLike)
}

// The last version we notified about survives restarts, so a user who ignores it is not nagged on every launch.
const notifiedFile = (): string => join(app.getPath('userData'), 'update-notified.json')

function lastNotifiedVersion(): string | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(notifiedFile(), 'utf8'))
    const version = typeof raw === 'object' && raw !== null ? (raw as { version?: unknown }).version : undefined
    return typeof version === 'string' ? version : null
  } catch {
    return null
  }
}

async function rememberNotified(version: string): Promise<void> {
  try {
    await mkdir(dirname(notifiedFile()), { recursive: true })
    await writeFile(notifiedFile(), JSON.stringify({ version }))
  } catch {
    // Worst case the next launch notifies again.
  }
}

let notified: string | null = null
// Held so the notification is not garbage-collected before the user clicks it.
const live = new Set<Notification>()

function notify(update: UpdateInfo): void {
  notified ??= lastNotifiedVersion()
  if (notified === update.version || !Notification.isSupported()) return
  notified = update.version
  void rememberNotified(update.version)
  const notification = new Notification({
    title: `${app.name} ${update.version} 已发布`,
    body: '点击查看更新内容并下载。',
    silent: true
  })
  live.add(notification)
  notification.on('click', () => void shell.openExternal(update.url))
  notification.on('close', () => live.delete(notification))
  notification.show()
}

async function checkAndNotify(): Promise<void> {
  const update = await checkForUpdates()
  if (update) notify(update)
}

export function registerUpdateHandlers(): void {
  ipcMain.handle(IPC.appCheckForUpdates, () => checkForUpdates())

  // Only release builds poll in the background; dev runs, the linked app and e2e never touch the network.
  if (isDeveloperBuild() || process.env.TR_DISABLE_UPDATE_CHECK) return
  setTimeout(() => {
    void checkAndNotify()
    setInterval(() => void checkAndNotify(), CHECK_INTERVAL_MS).unref()
  }, FIRST_CHECK_DELAY_MS).unref()
}
