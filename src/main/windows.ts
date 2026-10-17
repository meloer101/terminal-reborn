// Window factory and the app menu.
import { app, BrowserWindow, Menu, shell, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { viewMenuItems } from '@shared/lifecycle'
import { SHORTCUTS, stepFontSize, type FontSizeStep, type MenuCommand } from '@shared/shortcuts'
import { clearActivity } from './activity'
import { releaseSessionsOf } from './pty'
import { isQuitting, quitEndingSessions } from './quit'
import { getSettings, updateSettings } from './settings'

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

/** Dev builds only (packaged builds have neither). */
const DEV_ITEM_LABEL: Record<'reload' | 'toggleDevTools', string> = { reload: '重新载入', toggleDevTools: '开发者工具' }

/** Sends a menu command to the window it was picked in (or the main window); the renderer runs it. */
function command(name: MenuCommand): Pick<MenuItemConstructorOptions, 'click'> {
  return {
    click: (_item, window) => {
      const target = window instanceof BrowserWindow ? window : getMainWindow()
      if (target && !target.isDestroyed()) target.webContents.send(IPC.uiMenuCommand, name)
    }
  }
}

function stepFont(step: FontSizeStep): void {
  void updateSettings({ appearance: { fontSize: stepFontSize(getSettings().appearance.fontSize, step) } })
}

/**
 * The app menu, in Chinese (B8). Shortcuts come from @shared/shortcuts so the menu, ⌘K and the sidebar agree.
 * Commands the renderer owns are sent to it (`ui:menu-command`); editing keeps the native roles (copy/paste need
 * the Edit menu); font size is a setting, changed here.
 */
export function installAppMenu(): void {
  const devItems: MenuItemConstructorOptions[] = viewMenuItems(app.isPackaged)
    .filter((item) => item !== 'togglefullscreen')
    .map((item) => (item === 'separator' ? { type: 'separator' } : { role: item, label: DEV_ITEM_LABEL[item] }))
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: `关于 ${app.name}` },
        { type: 'separator' },
        { label: '设置…', accelerator: SHORTCUTS.settings, click: (_item, window) => showSettings(window instanceof BrowserWindow ? window : null) },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${app.name}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        // Sessions keep running in the pty daemon after ⌘Q; this one ends them too.
        { role: 'quit', label: `退出 ${app.name}` },
        { label: '退出并结束所有会话…', accelerator: 'Alt+CmdOrCtrl+Q', click: () => quitEndingSessions(getMainWindow) }
      ]
    },
    {
      label: '文件',
      submenu: [
        { label: '新建会话', accelerator: SHORTCUTS['new-session'], ...command('new-session') },
        { label: '打开项目…', accelerator: SHORTCUTS['open-project'], ...command('open-project') },
        { type: 'separator' },
        // Not the window's Close: ⌘W closes the active session (with its confirmation).
        { label: '关闭会话', accelerator: SHORTCUTS['close-session'], ...command('close-session') }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        { label: '在终端中查找…', accelerator: SHORTCUTS.find, ...command('find') }
      ]
    },
    {
      label: '会话',
      submenu: [
        { label: '跳转到…', accelerator: SHORTCUTS['command-palette'], ...command('command-palette') },
        { label: '总览', accelerator: SHORTCUTS['toggle-overview'], ...command('toggle-overview') },
        { label: '下一个需要你的会话', accelerator: SHORTCUTS['next-attention'], ...command('next-attention') },
        { type: 'separator' },
        { label: '重命名会话', ...command('rename-session') }
      ]
    },
    {
      label: '显示',
      submenu: [
        { label: '显示 / 隐藏侧栏', accelerator: SHORTCUTS['toggle-sidebar'], ...command('toggle-sidebar') },
        { label: '显示 / 隐藏右侧栏', accelerator: SHORTCUTS['toggle-right-panel'], ...command('toggle-right-panel') },
        { type: 'separator' },
        { label: '放大', accelerator: SHORTCUTS['font-bigger'], click: () => stepFont('bigger') },
        // ⌘= is the unshifted key under ⌘+; it does the same, without a second visible item.
        { label: '放大', accelerator: 'CmdOrCtrl+=', visible: false, acceleratorWorksWhenHidden: true, click: () => stepFont('bigger') },
        { label: '缩小', accelerator: SHORTCUTS['font-smaller'], click: () => stepFont('smaller') },
        { label: '实际大小', accelerator: SHORTCUTS['font-reset'], click: () => stepFont('reset') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '进入全屏' },
        ...(devItems.length > 0 ? [{ type: 'separator' } as const, ...devItems] : [])
      ]
    },
    {
      role: 'window',
      label: '窗口',
      // Not `windowMenu`: its Close item owns ⌘W, which closes the active session instead (renderer).
      submenu: [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' }, { type: 'separator' }, { role: 'front', label: '前置全部窗口' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
