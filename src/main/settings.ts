// Settings persistence (PRD F7): <userData>/settings.json, sanitized on read and write, broadcast to
// every window on change. Main-process consumers (window vibrancy, …) subscribe with onSettingsChange.
// Disk handling (corrupt-file backup, the write chain) lives in ./settings-file.ts.
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC, type SettingsSaveError } from '@shared/ipc'
import { applySettingsPatch, type AppSettings } from '@shared/settings'
import { loadSettingsFile, SettingsWriter } from './settings-file'

let current: AppSettings | null = null
const listeners = new Set<(settings: AppSettings) => void>()
let writer: SettingsWriter | null = null

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function broadcastSaveError(error: Error): void {
  const payload: SettingsSaveError = { message: error.message }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(IPC.settingsSaveFailed, payload)
  }
}

export function getSettings(): AppSettings {
  if (!current) current = loadSettingsFile(file()).settings
  return current
}

export function onSettingsChange(listener: (settings: AppSettings) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function updateSettings(patch: unknown): Promise<AppSettings> {
  const previous = getSettings()
  const next = applySettingsPatch(previous, patch)
  // No-op patches neither write nor broadcast (keeps onChange → update round trips from looping).
  if (JSON.stringify(next) === JSON.stringify(previous)) return previous
  current = next
  writer ??= new SettingsWriter(file(), broadcastSaveError)
  await writer.write(next)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(IPC.settingsChanged, next)
  }
  for (const listener of listeners) listener(next)
  return next
}

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsUpdate, (_event, patch: unknown) => updateSettings(patch))
}
