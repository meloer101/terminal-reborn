// Native pickers and system services the renderer cannot reach itself.
import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { isAbsolute } from 'node:path'
import { IPC } from '@shared/ipc'

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')

// Notifications are garbage-collected (and their click handlers lost) unless something holds them.
const liveNotifications = new Set<Notification>()

export function registerUiHandlers(): void {

  ipcMain.on(IPC.uiRevealInFinder, (_event, path: unknown) => {
    if (typeof path === 'string' && path.length <= 4096 && isAbsolute(path)) shell.showItemInFolder(path)
  })

  ipcMain.on(IPC.uiSetBadge, (_event, count: unknown) => {
    const n = typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
    app.dock?.setBadge(n > 0 ? String(n) : '')
  })

  ipcMain.on(IPC.uiNotify, (event, raw: unknown) => {
    if (!Notification.isSupported() || typeof raw !== 'object' || raw === null) return
    const { title, body, tag } = raw as Record<string, unknown>
    const notification = new Notification({ title: text(title, 200), body: text(body, 500) })
    const sender = event.sender
    const release = () => liveNotifications.delete(notification)
    notification.on('click', () => {
      release()
      const win = BrowserWindow.fromWebContents(sender)
      win?.show()
      win?.focus()
      if (!sender.isDestroyed()) sender.send(IPC.uiNotificationClick, text(tag, 200))
    })
    notification.on('close', release)
    liveNotifications.add(notification)
    notification.show()
  })

  ipcMain.handle(IPC.uiPickFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>, buttonLabel: '打开项目' }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}
