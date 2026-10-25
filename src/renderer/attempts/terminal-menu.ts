// The terminal's own right-click menu away from links (Figma 26B): 复制 · 同任务多解… · 全选. 同任务多解 starts from the
// selected text, which works for every agent, hooks or not (PRD F4 v1.68).
import type { SessionId } from '@shared/types'
import { getSurface } from '../terminal/registry'
import { popupMenu, type MenuEntry } from '../ui/menu'
import { canRunSameTask, openSameTask } from './same-task-store'

export async function openTerminalMenu(sessionId: SessionId, at: { x: number; y: number }): Promise<void> {
  const surface = getSurface(sessionId)
  if (!surface) return
  const selection = surface.getSelection()
  const entries: MenuEntry[] = [
    { type: 'item', id: 'copy', label: '复制', accelerator: 'CmdOrCtrl+C', enabled: selection !== '' },
    { type: 'item', id: 'same-task', label: '同任务多解…', accelerator: 'Shift+CmdOrCtrl+N', enabled: canRunSameTask(sessionId) },
    { type: 'separator' },
    { type: 'item', id: 'select-all', label: '全选', accelerator: 'CmdOrCtrl+A' }
  ]
  const choice = await popupMenu(entries, at)
  if (choice === 'copy') void navigator.clipboard.writeText(selection).catch(() => {})
  else if (choice === 'same-task') openSameTask(sessionId, selection)
  else if (choice === 'select-all') surface.selectAll()
}
