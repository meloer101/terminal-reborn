// Native pickers and menus the renderer cannot create itself.
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell, type MenuItemConstructorOptions } from 'electron'
import { isAbsolute } from 'node:path'
import type { MenuEntry } from '@shared/ipc'
import { IPC } from '@shared/ipc'
import { parseMenuEntries } from './menu-spec'

function toTemplate(entries: MenuEntry[], choose: (id: string) => void): MenuItemConstructorOptions[] {
  return entries.map((entry) => {
    switch (entry.type) {
      case 'separator':
        return { type: 'separator' }
      case 'submenu':
        return { label: entry.label, submenu: toTemplate(entry.items, choose) }
      case 'item':
        return {
          label: entry.label,
          enabled: entry.enabled ?? true,
          click: () => choose(entry.id),
          // Display only: the renderer owns the keyboard shortcut.
          ...(entry.accelerator ? { accelerator: entry.accelerator, registerAccelerator: false } : {})
        }
    }
  })
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')

// Notifications are garbage-collected (and their click handlers lost) unless something holds them.
const liveNotifications = new Set<Notification>()

export function registerUiHandlers(): void {
  ipcMain.handle(IPC.uiConfirm, async (event, raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return false
    const o = raw as Record<string, unknown>
    const message = text(o.message, 300)
    const confirmLabel = text(o.confirmLabel, 40)
    if (!message || !confirmLabel) return false
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      type: (o.destructive === true ? 'warning' : 'question') as 'warning' | 'question',
      message,
      detail: text(o.detail, 1000) || undefined,
      buttons: [confirmLabel, '取消'],
      defaultId: o.destructive === true ? 1 : 0,
      cancelId: 1,
      noLink: true
    }
    const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    return result.response === 0
  })

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
    const options = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>, buttonLabel: '添加项目' }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.uiPopupMenu, (event, raw: unknown) => {
    const entries = parseMenuEntries(raw)
    const win = BrowserWindow.fromWebContents(event.sender)
    return new Promise<string | null>((resolve) => {
      const menu = Menu.buildFromTemplate(toTemplate(entries, resolve))
      // The close callback and an item's click can arrive in either order; the first resolve wins,
      // so give a click a moment to land before reporting a dismissal.
      menu.popup({ ...(win ? { window: win } : {}), callback: () => setTimeout(() => resolve(null), 100) })
    })
  })
}
