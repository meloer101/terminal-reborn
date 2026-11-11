// Executes a palette entry against the real stores. Kept apart from the pure model so
// entries.ts stays free of side effects.
import type { AgentKind } from '@shared/types'
import { restoreArchivedWorktree } from '../archive/actions'
import { openSchedules } from '../schedules/store'
import { openSameTaskForActive } from '../attempts/same-task-store'
import { openNewSessionSheet } from '../new-session/sheet-store'
import { openProjectInteractive } from '../state/session-actions'
import { useWorkspace } from '../state/workspace'
import { applyTheme, type ThemePreference } from '../theme'
import { setTab } from '../panels/git/store'
import { runChainCommand } from '../pull-requests/chain-actions'
import type { ChainCommand } from '../pull-requests/chain-zone'
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
    case 'new-session':
      openNewSessionSheet(currentProject(state)?.id ?? null)
      break
    case 'open-project':
      void openProjectInteractive()
      break
    case 'same-task':
      openSameTaskForActive()
      break
    case 'schedules':
      openSchedules()
      break
    case 'toggle-sidebar':
      state.toggleSidebar()
      break
    case 'toggle-overview':
      state.setMainView(state.mainView === 'overview' ? 'session' : 'overview')
      break
    case 'toggle-right-panel':
      state.toggleRightPanel()
      break
  }
}

/**
 * A Git group entry (合入链路 v2, Figma 73H): the right sidebar opens on Git · 变更 for the session, and the command runs
 * as the zone's button runs it (its Ship block, sheet or hand-off shows there).
 */
function runChain(worktreePath: string, sessionId: string, command: ChainCommand): void {
  const state = useWorkspace.getState()
  state.setActiveSession(sessionId)
  state.setRightPanel('git')
  setTab(worktreePath, 'changes')
  void runChainCommand(worktreePath, command, sessionId)
}

export function runEntry(entry: PaletteEntry): void {
  const target = entry.target
  // Picking a session, starting one or restoring an archive hands the keyboard to its terminal (B7); other actions give it back.
  const toTerminal = target.type === 'session' || target.type === 'archived' || (target.type === 'action' && NEW_KIND[target.action] !== undefined)
  // The new-session and 同任务多解 sheets take the keyboard themselves.
  const sheet = target.type === 'action' && (target.action === 'new-session' || target.action === 'same-task' || target.action === 'schedules')
  closeCommandPalette({ restoreFocus: !toTerminal && !sheet && target.type !== 'chain' })
  if (target.type === 'session') useWorkspace.getState().setActiveSession(target.sessionId)
  else if (target.type === 'archived') void restoreFromHistory(target.worktreeId)
  else if (target.type === 'chain') runChain(target.worktreePath, target.sessionId, target.command)
  else runAction(target.action)
}

/** 历史 (PRD F15): restore, or say why not. */
async function restoreFromHistory(worktreeId: string): Promise<void> {
  try {
    await restoreArchivedWorktree(worktreeId)
  } catch (error) {
    await window.tr.ui.confirm({
      message: '没能恢复这个归档',
      detail: error instanceof Error ? error.message : String(error),
      confirmLabel: '好',
      cancelLabel: '关闭'
    })
  }
}
