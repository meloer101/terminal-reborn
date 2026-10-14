// Live-session summary reported by the renderer (phase 2 · A1): main uses it to confirm quitting.
import { ipcMain } from 'electron'
import { IPC, type ActivitySummary } from '@shared/ipc'

let summary: ActivitySummary = { active: 0 }

export function getActivity(): ActivitySummary {
  return summary
}

export function registerActivityHandlers(): void {
  ipcMain.on(IPC.appReportActivity, (_event, raw: unknown) => {
    const active = typeof raw === 'object' && raw !== null ? (raw as { active?: unknown }).active : undefined
    if (typeof active === 'number' && Number.isInteger(active) && active >= 0 && active < 10_000) summary = { active }
  })
}
