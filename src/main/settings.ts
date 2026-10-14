// Settings persistence (PRD F7): <userData>/settings.json, sanitized on read and write, broadcast to
// every window on change. Main-process consumers (window vibrancy, …) subscribe with onSettingsChange.
import { app, BrowserWindow, ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { applySettingsPatch, sanitizeSettings, type AppSettings } from '@shared/settings'

let current: AppSettings | null = null
const listeners = new Set<(settings: AppSettings) => void>()
let writeChain: Promise<void> = Promise.resolve()

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): AppSettings {
  if (!current) {
    let raw: unknown = null
    try {
      raw = JSON.parse(readFileSync(file(), 'utf8'))
    } catch {
      // Missing or unreadable: defaults.
    }
    current = sanitizeSettings(raw)
  }
  return current
}

export function onSettingsChange(listener: (settings: AppSettings) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function persist(settings: AppSettings): Promise<void> {
  // Serialize writes; write-then-rename so a crash never leaves a truncated file.
  writeChain = writeChain.then(async () => {
    const tmp = `${file()}.tmp`
    await writeFile(tmp, JSON.stringify(settings, null, 2))
    await rename(tmp, file())
  })
  return writeChain.catch(() => {})
}

export async function updateSettings(patch: unknown): Promise<AppSettings> {
  const next = applySettingsPatch(getSettings(), patch)
  current = next
  await persist(next)
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
