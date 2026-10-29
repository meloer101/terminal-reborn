// Window factory and the app menu.
import { app, BrowserWindow, Menu, shell, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { viewMenuItems } from '@shared/lifecycle'
import { SHORTCUTS, stepFontSize, type FontSizeStep, type MenuCommand } from '@shared/shortcuts'
import { nativeGlass } from './appearance'
import { clearActivity } from './activity'
import { appWindows, isAppWindow, isSecondaryWindow, rendererOf } from './app-windows'
import { releaseSessionsOf } from './pty'
import { isQuitting, quitEndingSessions } from './quit'
import { adoptSecondaryWindow, closeSecondaryWindowsOf, secondaryKeyOf, secondaryWindowOptions } from './secondary-windows'
import { getSettings, updateSettings } from './settings'
import { isDeveloperBuild } from './source-checkout'
import { restoreBounds, saveBounds } from './window-state'

let mainWindow: BrowserWindow | null = null

function baseOptions(): BrowserWindowConstructorOptions {
  return {
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a0a0a',
    // SPIKE: Liquid Glass needs a transparent window (appearance.ts).
    transparent: nativeGlass,
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
  // …except the page's own secondary windows (F20 · 多窗口), which it draws itself.
  win.webContents.setWindowOpenHandler((details) => {
    const secondary = secondaryWindowOptions(details, baseOptions())
    if (secondary) return { action: 'allow', overrideBrowserWindowOptions: secondary }
    if (/^https?:/.test(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  win.webContents.on('did-create-window', (child, details) => adoptSecondaryWindow(child, win.webContents, details.frameName))
  // A reload (or a crash) takes the page that draws the secondary windows: they close, and the new page reopens them.
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) closeSecondaryWindowsOf(win.webContents)
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
  const win = new BrowserWindow({ ...baseOptions(), ...restored.options, ...min, title: app.name })
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
    closeSecondaryWindowsOf(win.webContents)
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.webContents.reload()
  })
  load(win)
  return win
}

/** Asks a window's renderer to show the settings dialog (Figma 07). */
export function showSettings(win: BrowserWindow | null | undefined): void {
  const target = win && !win.isDestroyed() ? win : (appWindows().find((w) => w.isFocused()) ?? appWindows()[0])
  if (!target) return
  target.show()
  // A secondary window is drawn by the main window's page, which shows the dialog in the window the user is in.
  rendererOf(target).send(IPC.uiShowSettings)
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

/** Dev runs and the linked app only (release builds have neither). */
const DEV_ITEM_LABEL: Record<'reload' | 'toggleDevTools', string> = { reload: '重新载入', toggleDevTools: '开发者工具' }

/** Sends a menu command to the window it was picked in (or the main window); the renderer runs it. */
function command(name: MenuCommand): Pick<MenuItemConstructorOptions, 'click'> {
  return {
    click: (_item, window) => {
      // In a page's sign-in pop-up only ⌘W means something: it closes the pop-up, never the session behind it.
      if (window instanceof BrowserWindow && !isAppWindow(window)) {
        if (name === 'close-session' && !window.isDestroyed()) window.close()
        return
      }
      const target = window instanceof BrowserWindow ? window : getMainWindow()
      if (!target || target.isDestroyed()) return
      // A secondary window's commands go to the page that draws it, with the window they were picked in.
      if (isSecondaryWindow(target)) rendererOf(target).send(IPC.uiMenuCommand, name, secondaryKeyOf(target))
      else target.webContents.send(IPC.uiMenuCommand, name)
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
  const devItems: MenuItemConstructorOptions[] = viewMenuItems(!isDeveloperBuild())
    .filter((item) => item !== 'togglefullscreen')
    .map((item) => (item === 'separator' ? { type: 'separator' } : { role: item, label: DEV_ITEM_LABEL[item] }))
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: `关于 ${app.name}` },
        { type: 'separator' },
        { label: '设置…', accelerator: SHORTCUTS.settings, click: (_item, window) => showSettings(window instanceof BrowserWindow ? window : null) },
        { label: '额度…', accelerator: SHORTCUTS['open-usage'], ...command('open-usage') },
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
        { label: '在新窗口中打开项目…', accelerator: SHORTCUTS['open-project-in-window'], ...command('open-project-in-window') },
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
        { label: '重命名会话', ...command('rename-session') },
        { label: '同任务多解…', accelerator: SHORTCUTS['same-task'], ...command('same-task') },
        { label: '合并到基线…', accelerator: SHORTCUTS['merge-worktree'], ...command('merge-worktree') }
      ]
    },
    {
      label: '显示',
      submenu: [
        { label: '显示 / 隐藏侧栏', accelerator: SHORTCUTS['toggle-sidebar'], ...command('toggle-sidebar') },
        { label: '显示 / 隐藏右侧栏', accelerator: SHORTCUTS['toggle-right-panel'], ...command('toggle-right-panel') },
        { type: 'separator' },
        // The main area's split (PRD F20).
        { label: '向右拆分', accelerator: SHORTCUTS['split-right'], ...command('split-right') },
        { label: '向下拆分', accelerator: SHORTCUTS['split-down'], ...command('split-down') },
        { label: '关掉这一格', accelerator: SHORTCUTS['close-pane'], ...command('close-pane') },
        { label: '移到左边的格', accelerator: SHORTCUTS['focus-pane-left'], ...command('focus-pane-left') },
        { label: '移到右边的格', accelerator: SHORTCUTS['focus-pane-right'], ...command('focus-pane-right') },
        { label: '移到上面的格', accelerator: SHORTCUTS['focus-pane-up'], ...command('focus-pane-up') },
        { label: '移到下面的格', accelerator: SHORTCUTS['focus-pane-down'], ...command('focus-pane-down') },
        { label: '把这一格移到新窗口', ...command('pane-to-window') },
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
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        // The red button only hides the main window; with secondary windows open the Dock icon no longer brings it back.
        { label: '主窗口', click: () => showMainWindow() },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
