// Runs the app menu's commands (B8) and the shortcuts that only the menu table defines (⌘B, ⇧⌘B, ⇧⌘M, and the
// split's ⌘D, ⇧⌘D, ⌥⌘W, ⌥⌘ arrows — PRD F20).
import type { MenuCommand } from '@shared/shortcuts'
import { toggleCommandPalette } from '../command-palette/palette-store'
import { toggleOverview } from '../overview/store'
import { jumpToNextAttention } from '../sidebar/shortcuts-runtime'
import { isKeyEcho, noteKeyCommand } from '../state/key-commands'
import { closeActiveSession, openProjectInteractive, quickNewSession } from '../state/session-actions'
import { useWorkspace } from '../state/workspace'
import { openTerminalSearch } from '../terminal/search-store'
import { openMergeForActiveSession } from '../panels/merge/store'
import { closeFocusedPane, focusPaneToward, splitFocusedPane } from '../split/commands'

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
  'toggle-right-panel': () => useWorkspace.getState().toggleRightPanel(),
  'merge-worktree': openMergeForActiveSession,
  'split-right': () => splitFocusedPane('right'),
  'split-down': () => splitFocusedPane('bottom'),
  'close-pane': closeFocusedPane,
  'focus-pane-left': () => focusPaneToward('left'),
  'focus-pane-right': () => focusPaneToward('right'),
  'focus-pane-up': () => focusPaneToward('up'),
  'focus-pane-down': () => focusPaneToward('down')
}

export function runMenuCommand(command: MenuCommand): void {
  if (!isKeyEcho(command)) RUN[command]()
}

const PANE_ARROWS: Record<string, MenuCommand> = {
  ArrowLeft: 'focus-pane-left',
  ArrowRight: 'focus-pane-right',
  ArrowUp: 'focus-pane-up',
  ArrowDown: 'focus-pane-down'
}

/** ⌘B, ⇧⌘B, ⇧⌘M and the split's keys, in the capture phase so they work while the terminal has focus. */
function keyCommand(e: KeyboardEvent): MenuCommand | null {
  if (!e.metaKey || e.ctrlKey) return null
  if (e.altKey) {
    if (e.shiftKey) return null
    if (e.code === 'KeyW') return 'close-pane'
    return PANE_ARROWS[e.key] ?? null
  }
  if (e.code === 'KeyB') return e.shiftKey ? 'toggle-right-panel' : 'toggle-sidebar'
  if (e.code === 'KeyM' && e.shiftKey) return 'merge-worktree'
  if (e.code === 'KeyD') return e.shiftKey ? 'split-down' : 'split-right'
  return null
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
