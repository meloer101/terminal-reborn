// Native pickers and menus the renderer cannot create itself.
import { BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron'
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
        return { label: entry.label, enabled: entry.enabled ?? true, click: () => choose(entry.id) }
    }
  })
}

export function registerUiHandlers(): void {
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
