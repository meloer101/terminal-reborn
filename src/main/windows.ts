// Window factory. Both windows load the same renderer bundle; the settings window is routed by the
// `#settings` hash (src/renderer/main.tsx).
import { app, BrowserWindow, Menu, shell, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { viewMenuItems } from '@shared/lifecycle'
import { clearActivity } from './activity'
import { releaseSessionsOf } from './pty'
import { isQuitting } from './quit'

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null

function baseOptions(): BrowserWindowConstructorOptions {
  return {
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  }
}

function load(win: BrowserWindow, hash?: string): void {
  win.once('ready-to-show', () => win.show())
  // Links open in the default browser; app windows never navigate away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(hash ? `${process.env.ELECTRON_RENDERER_URL}#${hash}` : process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({ ...baseOptions(), width: 1440, height: 900, minWidth: 960, minHeight: 600, title: 'Terminal Reborn' })
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  // The red close button only hides the window: agents keep running, and the Dock icon brings it back.
  win.on('close', (event) => {
    if (isQuitting() || process.platform !== 'darwin') return
    event.preventDefault()
    // A full-screen window must leave full screen first or macOS leaves an empty Space behind.
    if (win.isFullScreen()) {
      win.once('leave-full-screen', () => win.hide())
      win.setFullScreen(false)
    } else {
      win.hide()
    }
  })
  // A crashed renderer is reloaded; the workspace restores. Its terminals died with it, so release them.
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] renderer process gone:', details.reason, details.exitCode)
    clearActivity(win.webContents)
    releaseSessionsOf(win.webContents)
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.webContents.reload()
  })
  load(win)
  return win
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/** Shows (or recreates) the main window and focuses it: Dock click, second launch. */
export function showMainWindow(): BrowserWindow {
  const win = getMainWindow() ?? createMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return win
}

/** Opens the settings window (Figma 07, 1200×800), or focuses it if already open. */
export function openSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }
  const win = new BrowserWindow({ ...baseOptions(), width: 1200, height: 800, minWidth: 880, minHeight: 600, title: '设置' })
  settingsWindow = win
  win.on('closed', () => {
    if (settingsWindow === win) settingsWindow = null
  })
  load(win, 'settings')
  return win
}

/** macOS app menu: standard roles (copy/paste need the Edit menu) plus 设置… ⌘,. */
export function installAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => openSettingsWindow() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: viewMenuItems(app.isPackaged).map((item): MenuItemConstructorOptions => (item === 'separator' ? { type: 'separator' } : { role: item }))
    },
    // Not `windowMenu`: its Close item owns ⌘W, which closes the active session instead (renderer).
    { role: 'window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
