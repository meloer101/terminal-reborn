// Live-work summary reported by the renderer, read by the quit guard. Main cannot see sessions
// itself (the workspace lives in the renderer), so it trusts the latest report from each window.
import { ipcMain, type WebContents } from 'electron'
import { IPC } from '@shared/ipc'
import type { ActivitySummary } from '@shared/lifecycle'

const MAX_ACTIVE = 10_000
/** webContents id → running + waiting sessions in that window. */
const reports = new Map<number, number>()

export function parseActivity(raw: unknown): ActivitySummary {
  if (typeof raw !== 'object' || raw === null) throw new Error('invalid activity')
  const active = (raw as Record<string, unknown>).active
  if (typeof active !== 'number' || !Number.isFinite(active) || active < 0) throw new Error('invalid activity')
  return { active: Math.min(MAX_ACTIVE, Math.floor(active)) }
}

/** Running + waiting sessions across all windows. */
export function getActivity(): ActivitySummary {
  let active = 0
  for (const count of reports.values()) active += count
  return { active }
}

/** Forgets a window's report (it crashed or reloaded; the renderer re-reports once it is back). */
export function clearActivity(contents: WebContents): void {
  reports.delete(contents.id)
}

export function registerActivityHandlers(): void {
  ipcMain.on(IPC.appReportActivity, (event, raw: unknown) => {
    let summary: ActivitySummary
    try {
      summary = parseActivity(raw)
    } catch {
      return
    }
    const sender = event.sender
    const id = sender.id
    if (!reports.has(id)) sender.once('destroyed', () => reports.delete(id))
    reports.set(id, summary.active)
  })
  // A scheduled 继续 (PRD F11) must keep time in a hidden window; only while one waits, so hidden windows stay cheap.
  ipcMain.on(IPC.appKeepTimers, (event, raw: unknown) => {
    if (typeof raw !== 'boolean' || event.sender.isDestroyed()) return
    event.sender.setBackgroundThrottling(!raw)
  })
}
