// The merge chain's mechanical side in main (PRD F16 v1.78, Figma 29): preflight, the agent handoff files, 合并到 main
// 并推送, the diff a fix adds, risk markers, and CI on the base Wavi pushed. Channels in SHIP_IPC (src/shared/ship.ts).
import { ipcMain } from 'electron'
import { SHIP_IPC } from '@shared/ship'

const notReady = 'not implemented yet'

export function registerShipHandlers(): void {
  ipcMain.handle(SHIP_IPC.preflight, () => ({ ok: false, message: notReady }))
  ipcMain.handle(SHIP_IPC.handoff, () => ({ ok: false, message: notReady }))
  ipcMain.handle(SHIP_IPC.readHandoff, () => null)
  ipcMain.handle(SHIP_IPC.shipToMain, () => ({ ok: false, step: 'merge', reason: 'failed', message: notReady }))
  ipcMain.handle(SHIP_IPC.diffSince, () => null)
  ipcMain.handle(SHIP_IPC.risks, () => [])
  ipcMain.handle(SHIP_IPC.baseCi, () => null)
  ipcMain.handle(SHIP_IPC.baseFailure, () => null)
  ipcMain.handle(SHIP_IPC.baseFailing, () => null)
}
