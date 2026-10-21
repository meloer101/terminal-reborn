// Secondary windows (PRD F20 · 多窗口): a pane dragged out of a window, or a project opened in a window of its own.
// The main window's page opens them with `window.open('about:blank', 'wavi-window:<key>', features)` and draws into
// them itself — one renderer for every window, so sessions, their terminals and the PTY streams never move between
// processes. Main only allows these frame names, gives the windows the app's chrome and bounds that land on a display,
// reports where they are, and holds the red button back until the page has taken its terminals home.
import { BrowserWindow, ipcMain, screen, shell, type BrowserWindowConstructorOptions, type HandlerDetails, type WebContents } from 'electron'
import { IPC } from '@shared/ipc'
import { sanitizeWindowState } from '@shared/window-state'
import { isSecondaryKey, keyFromFrameName, type WindowKey, type WindowStateEvent } from '@shared/window-layout'
import { markSecondaryWindow } from './app-windows'
import { isQuitting } from './quit'

export const SECONDARY_MIN = { minWidth: 720, minHeight: 480 }
const DEFAULT_SIZE = { width: 1100, height: 760 }
const STATE_DELAY_MS = 300

interface Entry {
  key: WindowKey
  win: BrowserWindow
  opener: WebContents
  /** The page asked to close it (its terminals are home): the next close goes through. */
  closing: boolean
}

const entries = new Map<WindowKey, Entry>()
/** Pages that asked to keep their timers running while hidden (a scheduled 继续, activity.ts). */
const keepsTimers = new WeakSet<WebContents>()
/** Windows allowed to open that asked to start full screen (applied once they exist, so they get their own Space). */
const startFullScreen = new Set<WindowKey>()

/** Reads the `left/top/width/height/fullscreen` window features the page asked for. */
export function parseFeatures(features: string): { bounds: Record<string, number>; fullScreen: boolean } {
  const bounds: Record<string, number> = {}
  let fullScreen = false
  for (const part of features.split(',')) {
    const [rawName, rawValue] = part.split('=')
    const name = rawName?.trim().toLowerCase()
    const value = rawValue?.trim() ?? ''
    if (name === 'fullscreen') fullScreen = value === 'yes' || value === '1'
    const n = Number(value)
    if (!Number.isFinite(n)) continue
    if (name === 'left') bounds.x = n
    else if (name === 'top') bounds.y = n
    else if (name === 'width') bounds.width = n
    else if (name === 'height') bounds.height = n
  }
  return { bounds, fullScreen }
}

/** The `window.open` handler of an app window: secondary windows open with the app's chrome, anything else is denied. */
export function secondaryWindowOptions(details: HandlerDetails, base: BrowserWindowConstructorOptions): BrowserWindowConstructorOptions | null {
  const key = keyFromFrameName(details.frameName)
  if (!key || details.url !== 'about:blank' || entries.has(key)) return null
  const { bounds, fullScreen } = parseFeatures(details.features)
  if (fullScreen) startFullScreen.add(key)
  else startFullScreen.delete(key)
  const restored = sanitizeWindowState(
    { bounds: { ...DEFAULT_SIZE, ...bounds } },
    screen.getAllDisplays().map((d) => d.workArea),
    SECONDARY_MIN
  )
  return { ...base, ...SECONDARY_MIN, ...(restored?.bounds ?? DEFAULT_SIZE), fullscreen: false, show: true }
}

/**
 * A hidden page's timers are throttled. The main window's page also drives its secondary windows, so while it has any
 * (or asked for it) it keeps full-speed timers even when the main window is closed (hidden).
 */
function syncThrottling(page: WebContents): void {
  if (page.isDestroyed()) return
  page.setBackgroundThrottling(!(keepsTimers.has(page) || secondaryWindowsOf(page).length > 0))
}

export function setKeepTimers(page: WebContents, keep: boolean): void {
  if (keep) keepsTimers.add(page)
  else keepsTimers.delete(page)
  syncThrottling(page)
}

function sendState(entry: Entry): void {
  const { win, opener, key } = entry
  if (win.isDestroyed() || opener.isDestroyed()) return
  opener.send(IPC.uiWindowState, { key, bounds: win.getNormalBounds(), fullScreen: win.isFullScreen() } satisfies WindowStateEvent)
}

/** A secondary window `opener`'s page just opened. */
export function adoptSecondaryWindow(win: BrowserWindow, opener: WebContents, frameName: string): void {
  const key = keyFromFrameName(frameName)
  if (!key || entries.has(key)) {
    win.destroy()
    return
  }
  const entry: Entry = { key, win, opener, closing: false }
  entries.set(key, entry)
  markSecondaryWindow(win, opener)
  // Nothing loads in it: the opener draws it. Links open in the default browser as in the main window.
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (startFullScreen.delete(key)) win.setFullScreen(true)

  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = (): void => {
    timer ??= setTimeout(() => {
      timer = null
      sendState(entry)
    }, STATE_DELAY_MS)
  }
  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('enter-full-screen', schedule)
  win.on('leave-full-screen', schedule)
  // The bounds it actually got (the requested ones may have been moved onto a display).
  schedule()

  win.on('close', (event) => {
    if (entry.closing || isQuitting() || opener.isDestroyed()) return
    // The page moves the window's terminals back first, then closes it (closeSecondaryWindow).
    event.preventDefault()
    opener.send(IPC.uiWindowCloseRequest, key)
  })
  win.on('closed', () => {
    if (timer) clearTimeout(timer)
    if (entries.get(key) === entry) entries.delete(key)
    syncThrottling(opener)
    // Gone some other way than through the page (destroyed): the page forgets it too. Not on quit, which keeps it.
    if (!entry.closing && !isQuitting() && !opener.isDestroyed()) opener.send(IPC.uiWindowCloseRequest, key)
  })
  syncThrottling(opener)
}

/** Closes a secondary window for good. */
export function closeSecondaryWindow(opener: WebContents, key: WindowKey): void {
  const entry = entries.get(key)
  if (!entry || entry.opener !== opener) return
  entry.closing = true
  if (!entry.win.isDestroyed()) entry.win.destroy()
}

/** The opener's page went away (reload, crash): its windows go with it; the next page reopens them from the workspace. */
export function closeSecondaryWindowsOf(opener: WebContents): void {
  for (const entry of [...entries.values()]) if (entry.opener === opener) closeSecondaryWindow(opener, entry.key)
}

export function secondaryWindowsOf(opener: WebContents): BrowserWindow[] {
  return [...entries.values()].filter((e) => e.opener === opener && !e.win.isDestroyed()).map((e) => e.win)
}

/** The secondary window's key, or null for any other window. */
export function secondaryKeyOf(win: BrowserWindow): WindowKey | null {
  for (const entry of entries.values()) if (entry.win === win) return entry.key
  return null
}

function focus(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** `showMain` shows (or recreates) the main window and focuses it; `mainPage` is its page, the only one with windows. */
export function registerSecondaryWindowHandlers(showMain: () => void, mainPage: () => WebContents | null): void {
  ipcMain.on(IPC.uiWindowFocus, (event, key: unknown) => {
    if (key === 'main') {
      if (event.sender === mainPage()) showMain()
      return
    }
    if (!isSecondaryKey(key)) return
    const entry = entries.get(key)
    if (entry && entry.opener === event.sender) focus(entry.win)
  })
  ipcMain.on(IPC.uiWindowClose, (event, key: unknown) => {
    if (isSecondaryKey(key)) closeSecondaryWindow(event.sender, key)
  })
}
