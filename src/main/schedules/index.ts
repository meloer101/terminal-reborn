// 定时任务's IPC and clock in main (PRD F24): the Scheduler (./scheduler.ts) owns `<userData>/schedules.json`; this file
// ticks it, hands due runs to the main window once its page said it is ready, runs 前置检查 in the project's login
// shell, tells the pty daemon when to open the app if it is closed then, and keeps the login item in step with 设置.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, ipcMain, powerMonitor, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { parseDraft, parseRun, SCHEDULE_IPC, type Schedule, type ScheduleFire } from '@shared/schedule'
import { setDaemonWake } from '../pty'
import { startCapturedScript, cancelCapturedScript } from '../script-run'
import { getSettings, onSettingsChange } from '../settings'
import { getMainWindow } from '../windows'
import { projectRootOf } from '../workspace-store'
import { PRECHECK_TIMEOUT_MS, Scheduler, SchedulesFile } from './scheduler'

const TICK_MS = 15_000

let scheduler: Scheduler | null = null

/** The page that said it can run fires (its workspace is loaded); a reload has to say it again. */
let readyPage: WebContents | null = null

/** The `.app` bundle the daemon opens: only a packaged app has one (a dev run is picked up at its next launch). */
function appBundle(): string | null {
  if (!app.isPackaged) return null
  const at = process.execPath.indexOf('.app/')
  return at > 0 ? process.execPath.slice(0, at + 4) : null
}

/** The schedules a window can show, and to the daemon: the next time the app has to be up for one. */
function publish(schedules: Schedule[]): void {
  const page = getMainWindow()?.webContents
  if (page && !page.isDestroyed()) page.send(SCHEDULE_IPC.changed, schedules)
  syncWake()
}

function syncWake(): void {
  const settings = getSettings().schedules
  const at = settings.whileClosed && !settings.paused ? (scheduler?.wakeAt() ?? null) : null
  const bundle = appBundle()
  setDaemonWake(at !== null && bundle ? at : null, bundle)
}

function syncLoginItem(): void {
  if (!app.isPackaged || process.platform !== 'darwin') return
  const want = getSettings().schedules.openAtLogin
  if (app.getLoginItemSettings().openAtLogin !== want) app.setLoginItemSettings({ openAtLogin: want })
}

async function precheck(projectId: string, command: string, key: string): Promise<{ passed: boolean } | { error: string }> {
  const root = projectRootOf(projectId)
  if (!root) return { error: '项目不在了' }
  const timer = setTimeout(() => cancelCapturedScript(key), PRECHECK_TIMEOUT_MS)
  try {
    const run = await startCapturedScript({ key, cwd: root, script: command, baseEnv: process.env })
    if (run.cancelled) return { error: '前置检查 60 秒没跑完' }
    return { passed: run.code === 0 }
  } finally {
    clearTimeout(timer)
  }
}

function fire(payload: ScheduleFire): boolean {
  const page = readyPage
  if (!page || page.isDestroyed()) return false
  page.send(SCHEDULE_IPC.fire, payload)
  return true
}

const isMainPage = (event: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean => event.sender === getMainWindow()?.webContents
const parseId = (raw: unknown): string => {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(raw)) throw new Error('bad schedule id')
  return raw
}

/** For `wavi schedule` (PRD F24): the dispatch handler creates an agent's task once the user said 开始. */
export function schedulerForAgents(): Scheduler | null {
  return scheduler
}

export function registerScheduleHandlers(): void {
  const current = new Scheduler(new SchedulesFile(join(app.getPath('userData'), 'schedules.json')), {
    now: () => Date.now(),
    newId: () => randomUUID(),
    precheck,
    fire,
    changed: publish,
    paused: () => getSettings().schedules.paused
  })
  scheduler = current

  const handle = (channel: string, action: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!isMainPage(event)) throw new Error('not the main window')
      return action(...args)
    })
  }
  handle(SCHEDULE_IPC.list, () => current.list())
  handle(SCHEDULE_IPC.create, (raw) => {
    const draft = parseDraft(raw)
    return draft ? current.create(draft) : null
  })
  handle(SCHEDULE_IPC.update, (id, raw) => {
    const draft = parseDraft(raw)
    return draft ? current.update(parseId(id), draft) : null
  })
  handle(SCHEDULE_IPC.setEnabled, (id, enabled) => current.setEnabled(parseId(id), enabled === true))
  handle(SCHEDULE_IPC.keep, (id) => current.keep(parseId(id)))
  handle(SCHEDULE_IPC.remove, (id) => current.remove(parseId(id)))
  handle(SCHEDULE_IPC.runNow, (id) => current.runNow(parseId(id)))
  handle(SCHEDULE_IPC.report, (id, raw) => {
    const run = parseRun(raw)
    if (run) current.report(parseId(id), run)
  })
  ipcMain.on(SCHEDULE_IPC.ready, (event) => {
    if (!isMainPage(event)) return
    readyPage = event.sender
    event.sender.once('destroyed', () => {
      if (readyPage === event.sender) readyPage = null
    })
    event.sender.once('did-start-navigation', () => {
      if (readyPage === event.sender) readyPage = null
    })
    current.tick()
  })

  const timer = setInterval(() => current.tick(), TICK_MS)
  // The Mac slept: what came due meanwhile is caught up (or recorded as missed) at once, not at the next tick.
  powerMonitor.on('resume', () => current.tick())
  onSettingsChange(() => {
    syncWake()
    syncLoginItem()
  })
  app.on('before-quit', () => {
    clearInterval(timer)
    syncWake()
  })
  syncLoginItem()
  syncWake()
}
