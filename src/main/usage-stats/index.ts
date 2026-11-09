// 设置 · 额度's token statistics (PRD F11 · 额度页): the IPC handler over the usage-stats worker. The only file of this
// module that touches Electron (.dependency-cruiser.cjs `usage-stats-stands-alone`).
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { UsageDataset } from '@shared/usage-stats'
import { UsageStatsService } from './service'

export function registerUsageStatsHandlers(): void {
  const service = new UsageStatsService(join(__dirname, 'usage-stats-worker.js'))
  ipcMain.handle(IPC.agentGetUsageStats, (): Promise<UsageDataset> => service.scan())
  app.on('will-quit', () => service.dispose())
}
