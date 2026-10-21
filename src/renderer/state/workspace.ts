// Workspace-wide state: what exists and what is selected.
// Feature-specific state (drafts, terminal instances, panel internals) lives in each
// feature's own store, not here — keeps parallel work from colliding on this file.
import { useContext } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { WorktreeArchive } from '@shared/archive'
import { rememberWorkdir, type Workdir } from '@shared/new-session'
import type { AgentKind, ProjectId, Session, SessionId, Worktree, WorktreeId } from '@shared/types'
import { hasPane, pane, paneIds, PICKER_PANE, placeSession, removePane, replacePane, sessionsIn, splitPane, type DropZone, type Side, type SplitNode } from '@shared/split-layout'
import {
  closeWindow,
  EMPTY_VIEW,
  focusWindow,
  MAIN_WINDOW,
  newWindowKey,
  openWindow,
  patchWindow,
  reconcileWindows,
  restoreWindows,
  serializeWindows,
  shownAnywhere,
  shownIn,
  takeFromOthers,
  windowShowing,
  type PaneView,
  type SecondaryWindow,
  type WindowBounds,
  type WindowKey,
  type Windowed,
  type WindowsLayout
} from '@shared/window-layout'
import { mockProjects, mockSessions, mockWorktrees } from './mock-data'
import { WindowScopeContext } from './window-context'
import {
  addProject,
  addRunSession,
  addSession,
  addSessionInWorktree,
  closeSession,
  forgetWorktrees,
  archiveWorktrees,
  unarchiveWorktrees,
  persistedStateChanged,
  projectOfSession,
  reconcileSplit,
  rememberRecentProject,
  removedSessionIds,
  removeProject,
  restoreWorkspace,
  serializeWorkspace,
  type WorkspaceData
} from './workspace-model'
import { drafts, initialWorkspaceFile, requestSave, setSnapshotProvider } from './persistence'
import { reviewCommentsSnapshot } from './review-comments'
import { attemptGroupsSnapshot, pruneGroups } from './attempt-groups'
import { clampPanelWidth, clampSidebarWidth, PANEL_WIDTH_DEFAULT, SIDEBAR_WIDTH_DEFAULT, type DiffLayout, type PersistedRightPanel } from '@shared/workspace-file'

/** The right panel's views (PRD F17), switched by the icons in the session header. */
export type PanelView = PersistedRightPanel

/** What the main area shows: the active session's terminal, or the cross-project overview (PRD F9). */
export type MainView = 'session' | 'overview'

interface WorkspaceState extends WorkspaceData {
  /**
   * The main area's split (PRD F20): null = the active session alone; otherwise the active session is one of its panes.
   * With several windows (F20 · 多窗口) `split` and `activeSessionId` are the panes of the window with the keyboard.
   */
  split: SplitNode | null
  /** Secondary windows, in the order they were opened (the main window is not listed). */
  windows: readonly SecondaryWindow[]
  /** The window with the keyboard: its panes are `split` / `activeSessionId`. */
  keyWindow: WindowKey
  /** The panes of every other window, by key. */
  windowViews: Readonly<Record<WindowKey, PaneView>>
  sidebarCollapsed: boolean
  /** Sidebar width in px (dragged by its right edge). */
  sidebarWidth: number
  /** null = right panel closed */
  rightPanel: PanelView | null
  /** The view ⇧⌘B reopens. */
  lastRightPanel: PanelView
  /** Card width in px (dragged by its left edge). */
  rightPanelWidth: number
  /** Git · 变更 layout the user picked; split shows only while the panel is wide enough (PRD F5). */
  diffLayout: DiffLayout
  /** Projects folded in the sidebar. */
  collapsedProjectIds: ProjectId[]
  mainView: MainView
  /** Folders opened as projects, most recent first (first-run screen). */
  recentProjects: readonly string[]
  /** 工作目录 last used in the new-session sheet, by project (PRD F4). */
  newSessionWorkdir: Readonly<Record<ProjectId, Workdir>>
  /** Bumped whenever the keyboard should go to the active session's terminal (B7), even if it is already active. */
  focusRequest: number
  /** Bumped by 会话 › 重命名会话: the header starts renaming the active session. */
  renameRequest: number

  /**
   * Selects a session, shows its terminal (leaves the overview) and gives that terminal the keyboard. In a split
   * (PRD F20) a session already shown keeps its pane; another one takes the picker's pane, else the focused one.
   */
  setActiveSession(id: SessionId): void
  /** The keyboard moved into a shown pane (a click in its terminal): it becomes the active session. */
  focusPane(id: SessionId): void
  /** ⌘D / ⇧⌘D: a new pane beside the focused one that first picks its session. False when one is already picking. */
  openPicker(side: Side): boolean
  /** Shows a session in the picker's pane and gives it the keyboard. */
  pickForPane(id: SessionId): void
  /** Closes one pane (the picker's too); its session keeps running. The last pane left fills the area again. */
  closePane(id: SessionId): void
  /** A session dropped on a pane (from the sidebar, or a pane moved by its title): it gets the keyboard. */
  dropSession(id: SessionId, target: SessionId, zone: DropZone): void
  /** A resized split. */
  setSplit(split: SplitNode): void
  /** Gives the active session's terminal the keyboard once it can take it. */
  requestTerminalFocus(): void
  requestRename(): void
  setMainView(view: MainView): void
  toggleSidebar(): void
  setSidebarWidth(width: number): void
  setRightPanel(view: PanelView | null): void
  /** Header icon: opens that view, or closes the panel when it is the one showing. */
  togglePanelView(view: PanelView): void
  /** ⇧⌘B: closes the panel, or reopens the last view. */
  toggleRightPanel(): void
  setRightPanelWidth(width: number): void
  setDiffLayout(layout: DiffLayout): void
  toggleProjectCollapsed(id: ProjectId): void
  /** Adds (or finds) the project for a folder. */
  addProject(rootPath: string): ProjectId
  removeProject(id: ProjectId): void
  /** Starts a session in the project and selects it; null if the project is gone. */
  addSession(projectId: ProjectId, kind: AgentKind): SessionId | null
  /** Starts a session in one of the project's worktree folders (Worktree view) and selects it. */
  addSessionInWorktree(projectId: ProjectId, target: { path: string; branch: string; baseBranch?: string }, kind: AgentKind): SessionId | null
  /**
   * 一题多解: starts a session in a new worktree folder without selecting it (the overview shows the group). The
   * selection stays where it was; with none, the new session takes it.
   */
  addBackgroundSession(projectId: ProjectId, target: { path: string; branch: string; baseBranch?: string }, kind: AgentKind): SessionId | null
  /** Adds the Run button's terminal for a worktree (PRD F4) and selects it. */
  addRunSession(worktreeId: WorktreeId): SessionId | null
  /** Remembers the new-session sheet's 工作目录 for a git project. */
  rememberWorkdir(projectId: ProjectId, choice: Workdir): void
  closeSession(id: SessionId): void
  /** Drops linked worktree records whose folder was deleted, with their sessions (Worktree view). */
  forgetWorktrees(ids: WorktreeId[]): void
  /** Folds archived worktree records out of every list, keeping their sessions for the restore (PRD F15). */
  archiveWorktrees(ids: WorktreeId[], archive: WorktreeArchive): void
  /** Brings them back; agents resume on first view. */
  unarchiveWorktrees(ids: WorktreeId[]): void
  /** Live, non-persisted fields driven by agent signals (status track, M2). */
  patchSession(id: SessionId, patch: SessionPatch): void

  /** The keyboard went to another window (it was focused): its panes become `split` / `activeSessionId`. */
  focusWindow(key: WindowKey): void
  /**
   * Opens a secondary window that takes the keyboard (F20 · 多窗口). With `sessionId` the session moves there (a pane
   * dragged out); without, a project window shows the first of its sessions no window shows. Null at the window limit.
   */
  openWindow(options: { projectId: ProjectId | null; sessionId?: SessionId; bounds?: WindowBounds; sidebarCollapsed?: boolean }): WindowKey | null
  /** A secondary window closed: its sessions keep running, shown nowhere. */
  closeWindow(key: WindowKey): void
  /** Where a secondary window is (reported by main) and whether it is full screen. */
  setWindowState(key: WindowKey, bounds: WindowBounds, fullScreen: boolean): void
}

export type SessionPatch = Partial<
  Pick<
    Session,
    | 'status'
    | 'currentAction'
    | 'title'
    | 'titleSource'
    | 'lastActivityAt'
    | 'agentSessionId'
    | 'phase'
    | 'lastReply'
    | 'finishedAt'
    | 'statusSince'
    | 'turnStartedAt'
  >
>

// End-to-end tests opt in to the Figma 01 fixtures and never touch the saved workspace.
const fixtures = (globalThis as { __TR_E2E__?: boolean }).__TR_E2E__ === true

const saved = fixtures ? null : initialWorkspaceFile()

function initialData(): WorkspaceData & { split: SplitNode | null; windows: readonly SecondaryWindow[]; keyWindow: WindowKey; windowViews: Record<WindowKey, PaneView> } {
  if (fixtures) {
    return { projects: mockProjects, worktrees: mockWorktrees, sessions: mockSessions, activeSessionId: mockSessions[0]?.id ?? null, split: null, windows: [], keyWindow: MAIN_WINDOW, windowViews: {} }
  }
  const data = restoreWorkspace(saved)
  const layout = restoreWindows(saved?.windows)
  return { ...data, split: data.split ?? null, windows: layout.windows, keyWindow: layout.keyWindow, windowViews: { ...layout.views } }
}

/** Effects of the windows on screen (app-shell/secondary-windows.ts): bring one forward when the keyboard goes there. */
export const windowEffects: { reveal(key: WindowKey): void } = { reveal: () => {} }

const windowed = (s: Pick<WorkspaceState, 'windows' | 'keyWindow' | 'windowViews' | 'split' | 'activeSessionId'>): Windowed => ({
  layout: { windows: s.windows, keyWindow: s.keyWindow, views: s.windowViews },
  top: { split: s.split, activeSessionId: s.activeSessionId }
})

const unwindowed = ({ layout, top }: Windowed): Pick<WorkspaceState, 'windows' | 'keyWindow' | 'windowViews' | 'split' | 'activeSessionId'> => ({
  windows: layout.windows,
  keyWindow: layout.keyWindow,
  windowViews: layout.views,
  split: top.split,
  activeSessionId: top.activeSessionId
})

/** A window's panes. */
export function paneViewOf(s: Pick<WorkspaceState, 'keyWindow' | 'windowViews' | 'split' | 'activeSessionId'>, key: WindowKey): PaneView {
  return key === s.keyWindow ? { split: s.split, activeSessionId: s.activeSessionId } : (s.windowViews[key] ?? EMPTY_VIEW)
}

export type { WindowsLayout }

const pick = (s: WorkspaceState): WorkspaceData => ({
  projects: s.projects,
  worktrees: s.worktrees,
  sessions: s.sessions,
  activeSessionId: s.activeSessionId,
  split: s.split
})

/** A split with fewer than two panes is no split. */
const atLeastTwo = (split: SplitNode | null): SplitNode | null => (split && paneIds(split).length >= 2 ? split : null)

export const useWorkspace = create<WorkspaceState>()((set, get) => {
  /**
   * Applies a workspace change with the split kept in step (reconcileSplit) and every other window too (a closed or
   * archived session's pane closes wherever it is; a session never shows in two windows), plus any UI fields.
   */
  const commit = (data: WorkspaceData, extra: Partial<WorkspaceState> = {}): void => {
    const next = reconcileSplit(data, pick(get()))
    const archived = new Set(next.worktrees.filter((w) => w.archived).map((w) => w.id))
    const listed = new Set(next.sessions.filter((s) => !archived.has(s.worktreeId)).map((s) => s.id))
    const projects = new Set(next.projects.map((p) => p.id))
    const state = get()
    const settled = reconcileWindows(
      { layout: { windows: state.windows, keyWindow: state.keyWindow, views: state.windowViews }, top: { split: next.split ?? null, activeSessionId: next.activeSessionId } },
      (id) => listed.has(id),
      (id) => projects.has(id)
    )
    set({ ...next, ...unwindowed(settled), ...extra })
  }
  /** Takes a session out of every window but the key one: it is about to be shown there. */
  const claim = (id: SessionId): void => {
    const state = get()
    const layout = takeFromOthers({ windows: state.windows, keyWindow: state.keyWindow, views: state.windowViews }, id)
    if (layout.views !== state.windowViews) set({ windowViews: layout.views })
  }
  /** The panes as a tree, a lone session included. */
  const root = (): SplitNode | null => {
    const { split, activeSessionId } = get()
    return split ?? (activeSessionId ? pane(activeSessionId) : null)
  }
  return {
    ...initialData(),
    sidebarCollapsed: saved?.sidebarCollapsed ?? false,
    sidebarWidth: saved?.sidebarWidth ?? SIDEBAR_WIDTH_DEFAULT,
    rightPanel: saved?.rightPanel ?? null,
    lastRightPanel: saved?.rightPanel ?? saved?.lastRightPanel ?? 'files',
    rightPanelWidth: saved?.rightPanelWidth ?? PANEL_WIDTH_DEFAULT,
    diffLayout: saved?.diffLayout ?? 'unified',
    collapsedProjectIds: saved?.collapsedProjectIds ?? [],
    mainView: 'session',
    recentProjects: saved?.recentProjects ?? [],
    newSessionWorkdir: saved?.newSessionWorkdir ?? {},
    focusRequest: 0,
    renameRequest: 0,

    setActiveSession: (id) => {
      // Already shown in another window: the keyboard goes there (that window comes forward).
      const where = windowShowing(windowed(get()), id)
      if (where !== null && where !== get().keyWindow) set(unwindowed(focusWindow(windowed(get()), where)))
      // The overview is the main window's: picking a session in another window leaves it up.
      const mainView = get().keyWindow === MAIN_WINDOW ? 'session' : get().mainView
      commit({ ...pick(get()), activeSessionId: id }, { mainView, focusRequest: get().focusRequest + 1 })
      windowEffects.reveal(get().keyWindow)
    },
    focusPane: (id) => {
      if (id !== get().activeSessionId && id !== PICKER_PANE && hasPane(get().split, id)) set({ activeSessionId: id })
    },
    openPicker(side) {
      const tree = root()
      const active = get().activeSessionId
      if (!tree || !active || hasPane(tree, PICKER_PANE)) return false
      set({ split: splitPane(tree, active, side, PICKER_PANE), mainView: 'session' })
      return true
    },
    pickForPane(id) {
      const split = get().split
      if (!split || !hasPane(split, PICKER_PANE) || hasPane(split, id)) return
      claim(id)
      set({ split: replacePane(split, PICKER_PANE, id), activeSessionId: id, focusRequest: get().focusRequest + 1 })
    },
    closePane(id) {
      const split = get().split
      if (!split || !hasPane(split, id)) return
      const { node, successor } = removePane(split, id)
      const left = node ? sessionsIn(node) : []
      // Only the picker would be left: nothing to show beside the session that stays.
      if (left.length === 0) {
        set({ split: null, focusRequest: get().focusRequest + 1 })
        return
      }
      const active = get().activeSessionId
      const keep = active !== null && id !== active && left.includes(active)
      const focus = keep ? active : successor && left.includes(successor) ? successor : (left[0] ?? active)
      set({ split: atLeastTwo(node), activeSessionId: focus, focusRequest: get().focusRequest + 1 })
    },
    dropSession(id, target, zone) {
      const tree = root()
      if (!tree || !hasPane(tree, target) || !get().sessions.some((s) => s.id === id)) return
      claim(id)
      set({ split: atLeastTwo(placeSession(tree, id, target, zone)), activeSessionId: id, mainView: 'session', focusRequest: get().focusRequest + 1 })
    },
    setSplit: (split) => set({ split: atLeastTwo(split) }),
    requestTerminalFocus: () => set((s) => ({ focusRequest: s.focusRequest + 1 })),
    requestRename: () => set((s) => ({ renameRequest: s.renameRequest + 1 })),
    setMainView: (view) => set({ mainView: view }),
    // In a secondary window ⌘B hides that window's sidebar.
    toggleSidebar: () =>
      set((s) => {
        const window = s.windows.find((w) => w.key === s.keyWindow)
        if (!window) return { sidebarCollapsed: !s.sidebarCollapsed }
        return { windows: patchWindow({ windows: s.windows, keyWindow: s.keyWindow, views: s.windowViews }, window.key, { sidebarCollapsed: !window.sidebarCollapsed }).windows }
      }),
    setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
    setRightPanel: (view) => set((s) => ({ rightPanel: view, lastRightPanel: view ?? s.lastRightPanel })),
    togglePanelView: (view) => get().setRightPanel(get().rightPanel === view ? null : view),
    toggleRightPanel: () => get().setRightPanel(get().rightPanel ? null : get().lastRightPanel),
    setRightPanelWidth: (width) => set({ rightPanelWidth: clampPanelWidth(width) }),
    setDiffLayout: (layout) => set({ diffLayout: layout }),
    toggleProjectCollapsed: (id) =>
      set((s) => ({
        collapsedProjectIds: s.collapsedProjectIds.includes(id)
          ? s.collapsedProjectIds.filter((x) => x !== id)
          : [...s.collapsedProjectIds, id]
      })),

    addProject(rootPath) {
      const result = addProject(pick(get()), rootPath)
      set({ ...result.data, recentProjects: rememberRecentProject(get().recentProjects, rootPath) })
      return result.projectId
    },
    removeProject: (id) => commit(removeProject(pick(get()), id)),
    addSession(projectId, kind) {
      const result = addSession(pick(get()), projectId, kind, Date.now())
      if (!result) return null
      commit(result.data)
      return result.sessionId
    },
    addSessionInWorktree(projectId, target, kind) {
      const result = addSessionInWorktree(pick(get()), projectId, target, kind, Date.now())
      if (!result) return null
      commit(result.data, { mainView: 'session', focusRequest: get().focusRequest + 1 })
      return result.sessionId
    },
    addBackgroundSession(projectId, target, kind) {
      const result = addSessionInWorktree(pick(get()), projectId, target, kind, Date.now())
      if (!result) return null
      commit({ ...result.data, activeSessionId: get().activeSessionId ?? result.sessionId })
      return result.sessionId
    },
    addRunSession(worktreeId) {
      const result = addRunSession(pick(get()), worktreeId, Date.now())
      if (!result) return null
      commit(result.data, { mainView: 'session', focusRequest: get().focusRequest + 1 })
      return result.sessionId
    },
    rememberWorkdir: (projectId, choice) => set((s) => ({ newSessionWorkdir: rememberWorkdir(s.newSessionWorkdir, projectId, choice, true) })),
    closeSession: (id) => {
      commit(closeSession(pick(get()), id))
      fillProjectWindow()
    },
    forgetWorktrees: (ids) => commit(forgetWorktrees(pick(get()), ids)),
    archiveWorktrees: (ids, archive) => commit(archiveWorktrees(pick(get()), ids, archive)),
    unarchiveWorktrees: (ids) => commit(unarchiveWorktrees(pick(get()), ids), { mainView: 'session', focusRequest: get().focusRequest + 1 }),
    patchSession: (id, patch) =>
      set((s) => {
        const index = s.sessions.findIndex((x) => x.id === id)
        const current = s.sessions[index]
        if (!current) return {}
        const keys = Object.keys(patch) as (keyof SessionPatch)[]
        if (keys.every((k) => current[k] === patch[k])) return {}
        const sessions = s.sessions.slice()
        sessions[index] = { ...current, ...patch }
        return { sessions }
      }),

    focusWindow: (key) => {
      const next = focusWindow(windowed(get()), key)
      if (next.layout.keyWindow !== get().keyWindow) set(unwindowed(next))
    },
    openWindow({ projectId, sessionId, bounds, sidebarCollapsed }) {
      const state = get()
      if (state.windows.length >= MAX_SECONDARY) return null
      const shown = new Set(shownAnywhere(windowed(state)))
      // A project window starts on the first of its sessions no window shows (or on nothing).
      const first =
        sessionId ??
        (projectId !== null ? state.sessions.find((s) => !shown.has(s.id) && listedIn(state, s.id) && projectOfSession(pick(state), s.id) === projectId)?.id : undefined) ??
        null
      const key = newWindowKey()
      const window: SecondaryWindow = { key, projectId, sidebarCollapsed: sidebarCollapsed ?? false, ...(bounds ? { bounds } : {}) }
      set({ ...unwindowed(openWindow(windowed(state), window, first)), focusRequest: state.focusRequest + 1 })
      return key
    },
    closeWindow: (key) => set(unwindowed(closeWindow(windowed(get()), key))),
    setWindowState(key, bounds, fullScreen) {
      const layout = patchWindow({ windows: get().windows, keyWindow: get().keyWindow, views: get().windowViews }, key, { bounds, fullScreen })
      if (layout.windows !== get().windows) set({ windows: layout.windows })
    }
  }

  /** A project window whose last session closed shows another of its project's sessions that no window shows, if any. */
  function fillProjectWindow(): void {
    const state = get()
    const window = state.windows.find((w) => w.key === state.keyWindow)
    if (!window || window.projectId === null || state.split) return
    const active = state.activeSessionId
    if (active !== null && projectOfSession(pick(state), active) === window.projectId) return
    const shown = new Set(Object.values(state.windowViews).flatMap(shownIn))
    const next = state.sessions.find((s) => !shown.has(s.id) && listedIn(state, s.id) && projectOfSession(pick(state), s.id) === window.projectId)?.id ?? null
    set({ activeSessionId: next, focusRequest: state.focusRequest + 1 })
  }
})

const MAX_SECONDARY = 8

/** Listed in the sidebar: not in an archived worktree. */
function listedIn(state: Pick<WorkspaceData, 'sessions' | 'worktrees'>, id: SessionId): boolean {
  const session = state.sessions.find((s) => s.id === id)
  return session !== undefined && state.worktrees.find((w) => w.id === session.worktreeId)?.archived === undefined
}

// Persist what defines the workspace (not live status, which changes constantly). The store in main
// debounces and writes atomically; a closed session's draft goes with it.
setSnapshotProvider(() => {
  const state = useWorkspace.getState()
  // The file's top-level panes are the main window's, whichever window has the keyboard.
  const { main, windows } = serializeWindows(windowed(state))
  return serializeWorkspace(
    { ...pick(state), split: main.split, activeSessionId: main.activeSessionId },
    {
      secondaryWindows: windows,
      sidebarCollapsed: state.sidebarCollapsed,
      sidebarWidth: state.sidebarWidth,
      rightPanel: state.rightPanel,
      lastRightPanel: state.lastRightPanel,
      rightPanelWidth: state.rightPanelWidth,
      diffLayout: state.diffLayout,
      collapsedProjectIds: state.collapsedProjectIds,
      recentProjects: state.recentProjects,
      newSessionWorkdir: state.newSessionWorkdir,
      attemptGroups: attemptGroupsSnapshot()
    },
    drafts.snapshot(),
    reviewCommentsSnapshot()
  )
})
useWorkspace.subscribe((state, prev) => {
  if (!persistedStateChanged(state, prev) && state.windows === prev.windows && state.windowViews === prev.windowViews) return
  const removed = removedSessionIds(state, prev)
  for (const id of removed) drafts.remove(id)
  if (removed.length > 0) pruneGroups(new Set(state.sessions.map((s) => s.id)))
  requestSave()
})

if (fixtures) (globalThis as { __trWorkspace?: typeof useWorkspace }).__trWorkspace = useWorkspace

/** The sessions the key window shows: every pane of the split (PRD F20), or the active session alone. */
export function shownSessionIds(state: Pick<WorkspaceState, 'split' | 'activeSessionId'>): SessionId[] {
  if (state.split) return sessionsIn(state.split)
  return state.activeSessionId ? [state.activeSessionId] : []
}

/** The sessions every window shows (F20 · 多窗口): they all have a terminal on screen. */
export function shownEverywhere(state: Pick<WorkspaceState, 'windows' | 'keyWindow' | 'windowViews' | 'split' | 'activeSessionId'>): SessionId[] {
  return shownAnywhere(windowed(state))
}

export function useActiveSession(): { session: Session; worktree: Worktree | undefined } | null {
  return useSessionView(undefined)
}

/** A session with its worktree: `id`, or the active session of the window it is drawn in when `id` is undefined. */
export function useSessionView(id: SessionId | undefined): { session: Session; worktree: Worktree | undefined } | null {
  const windowKey = useContext(WindowScopeContext).key
  const { session, worktree } = useWorkspace(
    useShallow((s) => {
      const target = id ?? paneViewOf(s, windowKey).activeSessionId
      const session = s.sessions.find((x) => x.id === target)
      return { session, worktree: session && s.worktrees.find((w) => w.id === session.worktreeId) }
    })
  )
  return session ? { session, worktree } : null
}

const fixtureSessionIds = new Set(mockSessions.map((s) => s.id))

/** What to start in the session's terminal. Fixture sessions are plain shells: they only stand in for agents. */
export function launchKind(session: Session): AgentKind {
  return fixtures && fixtureSessionIds.has(session.id) ? 'shell' : session.kind
}
