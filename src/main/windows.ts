// Window factory and the app menu.
import { app, BrowserWindow, Menu, shell, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { viewMenuItems } from '@shared/lifecycle'
import { clearActivity } from './activity'
import { releaseSessionsOf } from './pty'
import { isQuitting, quitEndingSessions } from './quit'

let mainWindow: BrowserWindow | null = null
import { restoreBounds, saveBounds } from './window-state'

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

function load(win: BrowserWindow): void {
  win.once('ready-to-show', () => win.show())
  // Links open in the default browser; app windows never navigate away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function createMainWindow(): BrowserWindow {
  const min = { minWidth: 960, minHeight: 600 }
  const restored = restoreBounds({ width: 1440, height: 900 }, min)
  const win = new BrowserWindow({ ...baseOptions(), ...restored.options, ...min, title: 'Terminal Reborn' })
  saveBounds(win, restored)
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
  // A crashed renderer is reloaded; the workspace restores. With the pty daemon its terminals keep running and the
  // reloaded window reattaches them; with the fallback host they are killed.
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] renderer process gone:', details.reason, details.exitCode)
    clearActivity(win.webContents)
    releaseSessionsOf(win.webContents)
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.webContents.reload()
  })
  load(win)
  return win
}

/** Asks a window's renderer to show the settings dialog (Figma 07). */
export function showSettings(win: BrowserWindow | null | undefined): void {
  const target = win && !win.isDestroyed() ? win : (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])
  if (!target) return
  target.show()
  target.webContents.send(IPC.uiShowSettings)
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

/** macOS app menu: standard roles (copy/paste need the Edit menu) plus 设置… ⌘,. */
export function installAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: '设置…', accelerator: 'CmdOrCtrl+,', click: (_item, window) => showSettings(window instanceof BrowserWindow ? window : null) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        // Sessions keep running in the pty daemon after ⌘Q; this one ends them too.
        { role: 'quit' },
        { label: '退出并结束所有会话…', accelerator: 'Alt+CmdOrCtrl+Q', click: () => quitEndingSessions(getMainWindow) }
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
