// Runs the app menu's commands (B8) and the shortcuts that only the menu table defines (⌘B, ⇧⌘B, ⇧⌘M, and the
// split's ⌘D, ⇧⌘D, ⌥⌘W, ⌥⌘ arrows — PRD F20). They act in the window with the keyboard (F20 · 多窗口); the ones that
// only the main window has (overview, right panel, merge sheet) bring the main window forward first.
import type { MenuCommand } from '@shared/shortcuts'
import { MAIN_WINDOW, type WindowKey } from '@shared/window-layout'
import { toggleCommandPalette } from '../command-palette/palette-store'
import { toggleOverview } from '../overview/store'
import { jumpToNextAttention } from '../sidebar/shortcuts-runtime'
import { isKeyEcho, noteKeyCommand } from '../state/key-commands'
import { closeActiveSession, openProjectInNewWindowInteractive, openProjectInteractive, quickNewSession } from '../state/session-actions'
import { useWorkspace, windowEffects } from '../state/workspace'
import { openTerminalSearch } from '../terminal/search-store'
import { openMergeForActiveSession } from '../panels/merge/store'
import { closeFocusedPane, focusPaneToward, moveFocusedPaneToNewWindow, splitFocusedPane } from '../split/commands'
import { everyWindow } from './windows-runtime'

/** Runs `run` in the main window: from a secondary window that window comes forward and takes the keyboard first. */
function inMainWindow(run: () => void): () => void {
  return () => {
    const state = useWorkspace.getState()
    if (state.keyWindow !== MAIN_WINDOW) {
      state.focusWindow(MAIN_WINDOW)
      windowEffects.reveal(MAIN_WINDOW)
    }
    run()
  }
}

const RUN: Record<MenuCommand, () => void> = {
  'new-session': () => void quickNewSession(),
  'open-project': () => void openProjectInteractive(),
  'close-session': () => void closeActiveSession(),
  find: () => void openTerminalSearch(),
  'command-palette': toggleCommandPalette,
  'toggle-overview': inMainWindow(toggleOverview),
  'next-attention': () => void jumpToNextAttention(),
  'rename-session': () => useWorkspace.getState().requestRename(),
  'toggle-sidebar': () => useWorkspace.getState().toggleSidebar(),
  'toggle-right-panel': inMainWindow(() => useWorkspace.getState().toggleRightPanel()),
  // The sheet is for the session the keyboard is in; it shows in the main window (secondary-windows.tsx).
  'merge-worktree': openMergeForActiveSession,
  'split-right': () => splitFocusedPane('right'),
  'split-down': () => splitFocusedPane('bottom'),
  'close-pane': closeFocusedPane,
  'focus-pane-left': () => focusPaneToward('left'),
  'focus-pane-right': () => focusPaneToward('right'),
  'focus-pane-up': () => focusPaneToward('up'),
  'focus-pane-down': () => focusPaneToward('down'),
  'open-project-in-window': () => void openProjectInNewWindowInteractive(),
  'pane-to-window': moveFocusedPaneToNewWindow
}

/** `windowKey`: the secondary window the command was picked in (it has the keyboard); absent for the main window. */
export function runMenuCommand(command: MenuCommand, windowKey?: WindowKey): void {
  if (isKeyEcho(command)) return
  useWorkspace.getState().focusWindow(windowKey ?? MAIN_WINDOW)
  RUN[command]()
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
const uninstall = everyWindow((win) => {
  win.addEventListener('keydown', onKeyDown, true)
  return () => win.removeEventListener('keydown', onKeyDown, true)
})
const unsubscribe = window.tr.ui.onMenuCommand(runMenuCommand)
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    uninstall()
    unsubscribe()
  })
}
