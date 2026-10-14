// Window bounds persistence (phase 2 · A12): <userData>/window-state.json, restored on creation and
// saved (debounced) whenever the window moves, resizes or closes.
import { app, screen, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { sanitizeWindowState, type RestoredWindowState, type WindowLimits, type WindowState } from '@shared/window-state'

const SAVE_DELAY_MS = 500

function file(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function read(limits: WindowLimits): RestoredWindowState | null {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    return null
  }
  return sanitizeWindowState(raw, screen.getAllDisplays().map((d) => d.workArea), limits)
}

function write(state: WindowState): void {
  try {
    mkdirSync(dirname(file()), { recursive: true })
    const tmp = `${file()}.tmp`
    writeFileSync(tmp, JSON.stringify(state))
    renameSync(tmp, file())
  } catch (error) {
    console.error('[window-state] could not save window bounds', error)
  }
}

export interface RestoredBounds {
  options: Pick<BrowserWindowConstructorOptions, 'x' | 'y' | 'width' | 'height'>
  /** Applied once the window exists. */
  maximized: boolean
  fullScreen: boolean
}

/** Constructor bounds from the last session, or the given defaults on first run / unusable data. */
export function restoreBounds(defaults: { width: number; height: number }, limits: WindowLimits): RestoredBounds {
  const saved = read(limits)
  if (!saved) return { options: defaults, maximized: false, fullScreen: false }
  return { options: saved.bounds, maximized: saved.maximized, fullScreen: saved.fullScreen }
}

/** Applies the restored maximized / full-screen state and keeps the file up to date from now on. */
export function saveBounds(win: BrowserWindow, restored: Pick<RestoredBounds, 'maximized' | 'fullScreen'>): void {
  if (restored.maximized) win.maximize()
  if (restored.fullScreen) win.setFullScreen(true)

  let timer: ReturnType<typeof setTimeout> | null = null
  const save = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (win.isDestroyed()) return
    // The normal bounds, so a maximized or full-screen window still remembers the size it returns to.
    write({ bounds: win.getNormalBounds(), maximized: win.isMaximized(), fullScreen: win.isFullScreen() })
  }
  const schedule = (): void => {
    timer ??= setTimeout(save, SAVE_DELAY_MS)
  }
  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('enter-full-screen', schedule)
  win.on('leave-full-screen', schedule)
  win.on('close', save)
}
