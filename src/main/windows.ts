// Window factory. Both windows load the same renderer bundle; the settings window is routed by the
// `#settings` hash (src/renderer/main.tsx).
import { app, BrowserWindow, Menu, shell, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'

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
  load(win)
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
