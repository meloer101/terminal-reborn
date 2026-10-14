// Executes a palette entry against the real stores. Kept apart from the pure model so
// entries.ts stays free of side effects.
import type { AgentKind, SessionId } from '@shared/types'
import { addProjectInteractive } from '../state/session-actions'
import { useWorkspace } from '../state/workspace'
import { getSurface } from '../terminal/registry'
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

/**
 * After the active session changes, the previous focus target is usually a hidden terminal.
 * If nothing ended up focused, hand focus to the new session's terminal (created lazily on
 * first view, hence the short wait).
 */
function focusTerminalWhenIdle(sessionId: SessionId): void {
  let frames = 0
  const tick = () => {
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected) return // focus restored elsewhere (e.g. composer)
    const surface = getSurface(sessionId)
    if (surface) surface.focus()
    else if (++frames < 30) requestAnimationFrame(tick)
  }
  // Two frames: the first is the palette's own focus restore.
  requestAnimationFrame(() => requestAnimationFrame(tick))
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
    case 'toggle-changes':
      state.setRightPanel(state.rightPanel === 'changes' ? null : 'changes')
      break
  }
}

export function runEntry(entry: PaletteEntry): void {
  closeCommandPalette()
  const before = useWorkspace.getState().activeSessionId
  if (entry.target.type === 'session') useWorkspace.getState().setActiveSession(entry.target.sessionId)
  else runAction(entry.target.action)
  const after = useWorkspace.getState().activeSessionId
  if (after && after !== before) focusTerminalWhenIdle(after)
}
