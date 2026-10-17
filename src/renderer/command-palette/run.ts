// Executes a palette entry against the real stores. Kept apart from the pure model so
// entries.ts stays free of side effects.
import type { AgentKind } from '@shared/types'
import { addProjectInteractive } from '../state/session-actions'
import { useWorkspace } from '../state/workspace'
import { applyTheme, type ThemePreference } from '../theme'
import { closeCommandPalette } from './palette-store'
import { currentProject, type ActionId, type PaletteEntry } from './entries'

const NEW_KIND: Partial<Record<ActionId, AgentKind>> = {
  'new-claude': 'claude',
  'new-codex': 'codex',
  'new-shell': 'shell'
}

const THEME: Partial<Record<ActionId, ThemePreference>> = {
  'theme-system': 'system',
  'theme-dark': 'dark',
  'theme-light': 'light'
}

let disposeTheme: (() => void) | null = null

function setTheme(preference: ThemePreference): void {
  disposeTheme?.()
  disposeTheme = applyTheme(preference)
}

function runAction(action: ActionId): void {
  const state = useWorkspace.getState()
  const kind = NEW_KIND[action]
  if (kind) {
    const project = currentProject(state)
    if (project) state.addSession(project.id, kind)
    return
  }
  const theme = THEME[action]
  if (theme) {
    setTheme(theme)
    return
  }
  switch (action) {
    case 'add-project':
      void addProjectInteractive()
      break
    case 'toggle-sidebar':
      state.toggleSidebar()
      break
    case 'toggle-overview':
      state.setMainView(state.mainView === 'overview' ? 'session' : 'overview')
      break
    case 'toggle-changes':
      state.setRightPanel(state.rightPanel === 'changes' ? null : 'changes')
      break
  }
}

export function runEntry(entry: PaletteEntry): void {
  const target = entry.target
  // Picking a session or starting one hands the keyboard to its terminal (B7); other actions give it back.
  const toTerminal = target.type === 'session' || NEW_KIND[target.action] !== undefined
  closeCommandPalette({ restoreFocus: !toTerminal })
  if (target.type === 'session') useWorkspace.getState().setActiveSession(target.sessionId)
  else runAction(target.action)
}
