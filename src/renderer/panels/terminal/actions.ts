// What the 终端 view's tabs do to their shells (PRD F17, Figma 76): open one in the worktree, close one (its process
// ends), adopt the ones the pty daemon still runs after a reload, and end them all when the worktree is removed.
// The terminals themselves are ordinary registry terminals (appearance, zoom, snapshots, reattach).
import { panelTerminalsOf, parsePanelTerminalId } from '@shared/panel-terminal'
import type { SessionId, Worktree, WorktreeId } from '@shared/types'
import { forgetLiveSessions, loadLiveSessions, takeReattach, useLiveSessions } from '../../terminal/live-sessions'
import { disposeTerminal, ensureTerminal } from '../../terminal/registry'
import { useWorkspace } from '../../state/workspace'
import { addTab, adoptTabs, nextTabId, removeTab, setTabTitle, tabsOf } from './store'

/** Where the shells run: the worktree's id (in their PTY ids) and folder (their cwd). */
export type PanelWorktree = Pick<Worktree, 'id' | 'path'>

/** Per open tab: stops following its title and its process's exit. */
const followed = new Map<SessionId, () => void>()

/** Creates the tab's terminal (its shell starts once a host shows it) and follows its title and its exit. */
function follow(id: SessionId, cwd: string): void {
  if (followed.has(id)) return
  const title = ensureTerminal(id, cwd, 'shell').surface.onTitleChange((text) => setTabTitle(id, text))
  // The shell ended (`exit`, or its PTY host died): the tab goes with it.
  const offExit = window.tr.pty.onExit(id, () => closeTab(id))
  followed.set(id, () => {
    title.dispose()
    offExit()
  })
}

/** The worktree's shells the pty daemon still runs from before this window loaded (a reload, a relaunch). */
function liveShells(worktreeId: WorktreeId): SessionId[] {
  const live = Object.values(useLiveSessions.getState().live).filter((s) => !s.exited)
  return panelTerminalsOf(live.map((s) => s.sessionId), worktreeId)
}

/** A new shell in the worktree, shown at once. */
export function openTab(worktree: PanelWorktree): SessionId {
  const id = nextTabId(worktree.id, liveShells(worktree.id))
  follow(id, worktree.path)
  addTab(id)
  return id
}

/**
 * Ends a daemon shell no terminal here has taken over (adopted after a reload but never shown): only the window that
 * attached a process may end it, so it is attached first.
 */
function endDetached(id: SessionId): Promise<void> {
  return window.tr.pty
    .attach(id)
    .then((attached) => {
      if (attached && !attached.exit) window.tr.pty.kill(id)
    })
    .catch(() => {})
}

/** Closes the tab; a running shell is killed and its saved screen goes. */
export function closeTab(id: SessionId): void {
  followed.get(id)?.()
  followed.delete(id)
  // Still reattachable: no terminal ever started on the daemon's process, so disposing it alone would not end it.
  const detached = takeReattach(id)
  disposeTerminal(id, true)
  if (detached) void endDetached(id)
  // Never adopted again by a later mount.
  forgetLiveSessions([id])
  removeTab(id)
}

/**
 * The view opened for the worktree: its tabs are the shells it has, with the ones the daemon still runs taken in
 * (they reattach with their output). With none at all a first shell opens. Nothing happens once `cancelled()` (the
 * view went away while the daemon's list loaded).
 */
export async function openWorktreeTabs(worktree: PanelWorktree, cancelled: () => boolean): Promise<void> {
  await loadLiveSessions()
  if (cancelled()) return
  const live = liveShells(worktree.id)
  for (const id of live) follow(id, worktree.path)
  adoptTabs(worktree.id, live)
  if (tabsOf(worktree.id).ids.length === 0) openTab(worktree)
}

/**
 * The worktrees are being removed: every shell of theirs ends, the ones never shown since a reload too (they are
 * attached first; only an owner may end a process).
 */
export async function closeWorktreeTabs(worktreeIds: readonly WorktreeId[]): Promise<void> {
  const ids = new Set(worktreeIds)
  for (const worktreeId of ids) for (const id of tabsOf(worktreeId).ids) closeTab(id)
  const unseen = Object.keys(useLiveSessions.getState().live).filter((id) => ids.has(parsePanelTerminalId(id)?.worktreeId ?? ''))
  forgetLiveSessions(unseen)
  await Promise.all(unseen.map(endDetached))
}

// However a worktree leaves the workspace (removed, archived, its project removed), its shells end with it.
useWorkspace.subscribe((state, prev) => {
  if (state.worktrees === prev.worktrees) return
  const kept = new Set(state.worktrees.filter((w) => !w.archived).map((w) => w.id))
  const gone = prev.worktrees.filter((w) => !w.archived && !kept.has(w.id)).map((w) => w.id)
  if (gone.length) void closeWorktreeTabs(gone)
})
