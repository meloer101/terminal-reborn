// Window factory and the app menu.
import { app, BrowserWindow, Menu, shell, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
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
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
