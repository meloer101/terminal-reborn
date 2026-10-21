// App-wide commands and their shortcuts (PRD F8, B8). One table for the native menu (main), the command
// palette and the sidebar hints, so a shortcut is spelled the same everywhere. Electron accelerator syntax.
import { DEFAULT_SETTINGS, LIMITS } from './settings'

/** Commands the app menu sends to the focused window (`ui:menu-command`); the renderer runs them. */
export const MENU_COMMANDS = [
  'new-session',
  'open-project',
  'close-session',
  'find',
  'command-palette',
  'toggle-overview',
  'next-attention',
  'rename-session',
  'toggle-sidebar',
  'toggle-right-panel',
  'merge-worktree',
  // The main area's split (PRD F20).
  'split-right',
  'split-down',
  'close-pane',
  'focus-pane-left',
  'focus-pane-right',
  'focus-pane-up',
  'focus-pane-down'
] as const

export type MenuCommand = (typeof MENU_COMMANDS)[number]

export function isMenuCommand(value: unknown): value is MenuCommand {
  return typeof value === 'string' && (MENU_COMMANDS as readonly string[]).includes(value)
}

/** Font size steps, handled in main (they only change a setting). */
export type FontSizeStep = 'bigger' | 'smaller' | 'reset'

export const SHORTCUTS = {
  'new-session': 'CmdOrCtrl+N',
  'open-project': 'CmdOrCtrl+O',
  'close-session': 'CmdOrCtrl+W',
  find: 'CmdOrCtrl+F',
  'command-palette': 'CmdOrCtrl+K',
  'toggle-overview': 'CmdOrCtrl+Shift+A',
  'next-attention': 'CmdOrCtrl+J',
  // As in VS Code / Cursor: ⌘B the left sidebar, ⇧⌘B the right panel.
  'toggle-sidebar': 'CmdOrCtrl+B',
  'toggle-right-panel': 'Shift+CmdOrCtrl+B',
  // ⌘M stays the system's Minimize; the merge sheet takes ⇧⌘M (PRD F4).
  'merge-worktree': 'Shift+CmdOrCtrl+M',
  // As in iTerm2 / Ghostty: ⌘D splits right, ⇧⌘D down, ⌥⌘ arrows move between panes (PRD F20). ⌘W stays 关闭会话.
  'split-right': 'CmdOrCtrl+D',
  'split-down': 'Shift+CmdOrCtrl+D',
  'close-pane': 'Alt+CmdOrCtrl+W',
  'focus-pane-left': 'Alt+CmdOrCtrl+Left',
  'focus-pane-right': 'Alt+CmdOrCtrl+Right',
  'focus-pane-up': 'Alt+CmdOrCtrl+Up',
  'focus-pane-down': 'Alt+CmdOrCtrl+Down',
  settings: 'CmdOrCtrl+,',
  'font-bigger': 'CmdOrCtrl+Plus',
  'font-smaller': 'CmdOrCtrl+-',
  'font-reset': 'CmdOrCtrl+0'
} as const satisfies Partial<Record<MenuCommand, string>> & Record<string, string>

/** ⌘+ / ⌘- / ⌘0: the terminal font size one step bigger, smaller, or back to the default (clamped to LIMITS). */
export function stepFontSize(current: number, step: FontSizeStep): number {
  if (step === 'reset') return DEFAULT_SETTINGS.appearance.fontSize
  const next = current + (step === 'bigger' ? 1 : -1)
  return Math.min(LIMITS.fontSize.max, Math.max(LIMITS.fontSize.min, next))
}
