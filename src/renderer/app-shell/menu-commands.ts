// Runs the app menu's commands (B8) and the shortcuts that only the menu table defines (⌘B, ⇧⌘B).
import type { MenuCommand } from '@shared/shortcuts'
import { toggleCommandPalette } from '../command-palette/palette-store'
import { toggleOverview } from '../overview/store'
import { jumpToNextAttention } from '../sidebar/shortcuts-runtime'
import { isKeyEcho, noteKeyCommand } from '../state/key-commands'
import { closeActiveSession, openProjectInteractive, quickNewSession } from '../state/session-actions'
import { useWorkspace } from '../state/workspace'
import { openTerminalSearch } from '../terminal/search-store'

const RUN: Record<MenuCommand, () => void> = {
  'new-session': () => void quickNewSession(),
  'open-project': () => void openProjectInteractive(),
  'close-session': () => void closeActiveSession(),
  find: () => void openTerminalSearch(),
  'command-palette': toggleCommandPalette,
  'toggle-overview': toggleOverview,
  'next-attention': () => void jumpToNextAttention(),
  'rename-session': () => useWorkspace.getState().requestRename(),
  'toggle-sidebar': () => useWorkspace.getState().toggleSidebar(),
  'toggle-right-panel': () => useWorkspace.getState().toggleRightPanel()
}

export function runMenuCommand(command: MenuCommand): void {
  if (!isKeyEcho(command)) RUN[command]()
}

/** ⌘B and ⇧⌘B, in the capture phase so they work while the terminal has focus. */
function keyCommand(e: KeyboardEvent): MenuCommand | null {
  if (!e.metaKey || e.ctrlKey || e.altKey || e.code !== 'KeyB') return null
  return e.shiftKey ? 'toggle-right-panel' : 'toggle-sidebar'
}

const onKeyDown = (e: KeyboardEvent): void => {
  const command = keyCommand(e)
  if (!command) return
  e.preventDefault()
  e.stopPropagation()
  noteKeyCommand(command)
  RUN[command]()
}
window.addEventListener('keydown', onKeyDown, true)
const unsubscribe = window.tr.ui.onMenuCommand(runMenuCommand)
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener('keydown', onKeyDown, true)
    unsubscribe()
  })
}
