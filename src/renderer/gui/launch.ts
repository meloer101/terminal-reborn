// Starting (or reattaching to) a GUI session's agent (PRD F23): the same launch fields a terminal's spawn carries
// (terminal/session-terminal.ts), sent to `window.tr.gui.open` instead. Main starts the agent if it is not running and
// answers with the conversation to draw; the session's phase moves like a started TUI's.
import type { CliAgent } from '@shared/agents'
import { emptyGuiState, type GuiLaunch, type GuiPicks } from '@shared/gui-chat'
import type { SessionId, WorktreeId } from '@shared/types'
import { takeDispatchLaunch } from '../dispatch/store'
import { reportLaunchIssue } from '../lifecycle/launch-issues'
import { useWorkspace } from '../state/workspace'
import { chatIsEmpty } from './model'
import { applyGuiEvents, guiStateOf, listenToGuiEvents, setGuiState } from './store'

export interface GuiLaunchInput {
  sessionId: SessionId
  cwd: string
  agent: CliAgent
  resumeAgentSessionId?: string
  /** A session `wavi run` started (PRD F21): `wavi` on PATH. */
  dispatched: boolean
  /** Its first launch's task and model (a resume never carries them). */
  dispatch?: { initialPrompt: string; model?: string }
  /** The 权限 and 计划 last chosen (Figma 56), so the agent starts — or is shown — with them. */
  permission?: GuiLaunch['permission']
  plan?: boolean
  /** Figma 65: the model, effort and 快速 the agent last ran with (a dispatch's model wins). */
  picks?: Pick<GuiPicks, 'model' | 'effort' | 'fast'>
}

export function guiLaunch(input: GuiLaunchInput): GuiLaunch {
  const dispatch = input.resumeAgentSessionId ? undefined : input.dispatch
  return {
    sessionId: input.sessionId,
    cwd: input.cwd,
    agent: input.agent,
    ...(input.resumeAgentSessionId ? { resumeAgentSessionId: input.resumeAgentSessionId } : {}),
    ...(input.dispatched ? { dispatched: true } : {}),
    ...(input.permission ? { permission: input.permission } : {}),
    ...(input.plan ? { plan: true } : {}),
    ...(input.picks?.model ? { model: input.picks.model } : {}),
    ...(input.picks?.effort ? { effort: input.picks.effort } : {}),
    ...(input.picks?.fast !== undefined ? { fast: input.picks.fast } : {}),
    ...(dispatch ? { initialPrompt: dispatch.initialPrompt, ...(dispatch.model ? { model: dispatch.model } : {}) } : {})
  }
}

/**
 * At load: GUI sessions whose agent process the pipe host still holds (it outlived the app in the pty daemon, or this
 * page reloaded) are opened, so their status, notifications and Dock badge flow before they are viewed, like adopted
 * terminals' (state/session-start.ts adoptLiveSessions). Opening only reattaches and folds the kept lines; nothing is
 * drawn until the session is shown. A process for no GUI session of the workspace (closed or archived while the app
 * was away) can never be seen or closed: it is ended. Main lists no other window's sessions, so none of those ends.
 */
export async function adoptGuiSessions(): Promise<void> {
  const live = await window.tr.gui.live().catch(() => [])
  const { sessions, worktrees } = useWorkspace.getState()
  for (const { sessionId } of live) {
    const session = sessions.find((s) => s.id === sessionId)
    const worktree = session ? worktrees.find((w) => w.id === session.worktreeId) : undefined
    if (!session || session.ui !== 'gui' || session.kind === 'shell' || worktree?.archived !== undefined) {
      void window.tr.gui.stop(sessionId).catch(() => {})
      continue
    }
    // Already started in this page (opened, or being opened): nothing to adopt.
    if (session.phase !== 'not-started') continue
    // Its saved conversation, as a start would pass it: only used if the process is gone by the time main looks.
    void openGuiSession(sessionId, worktree?.path ?? window.tr.homeDir, session.kind, session.agentSessionId)
  }
}

/** Opens the session's agent; resolves to whether it is up. A failure shows in the chat and ends the session's phase. */
export async function openGuiSession(sessionId: SessionId, cwd: string, agent: CliAgent, resumeAgentSessionId: string | undefined): Promise<boolean> {
  listenToGuiEvents()
  const { sessions, guiPicks } = useWorkspace.getState()
  const session = sessions.find((s) => s.id === sessionId)
  if (!session) return false
  const dispatch = resumeAgentSessionId ? undefined : takeDispatchLaunch(sessionId)
  // Figma 65: only a new session the user starts takes what its agent last ran with. A conversation resumed keeps its
  // own model; a dispatched one (its task is the first message) starts as the agent does by default.
  const fresh = !resumeAgentSessionId && !dispatch && session.dispatchedBy === undefined
  const picks = fresh ? (guiPicks[agent] ?? {}) : {}
  const launch = guiLaunch({
    sessionId,
    cwd,
    agent,
    resumeAgentSessionId,
    dispatched: session.dispatchedBy !== undefined,
    dispatch,
    // The session's own 权限 / 计划 once it has run; a new one starts with what its agent last ran with (Figma 65).
    ...(session.guiPermission ? { permission: session.guiPermission } : picks.permission ? { permission: picks.permission } : {}),
    ...((session.guiPermission ? session.guiPlan : picks.plan) ? { plan: true } : {}),
    picks
  })
  // Switched to another agent or folder while this one was still starting (retargetGuiSession): its answer is stale.
  const stale = (): boolean => {
    const now = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
    return !now || now.kind !== session.kind || now.worktreeId !== session.worktreeId
  }
  let reason: string
  try {
    const result = await window.tr.gui.open(launch)
    if (stale()) return false
    if (result.ok) {
      setGuiState(sessionId, result.state)
      // Up: the status machine takes it from here (controller.sync sees the phase; status comes with agent events). A
      // process that ended while the app was away is exited, like an adopted terminal that ended meanwhile.
      if (useWorkspace.getState().sessions.some((s) => s.id === sessionId)) {
        useWorkspace.getState().patchSession(sessionId, result.exited ? { phase: 'exited', status: 'exited' } : { phase: 'ready' })
      }
      return true
    }
    reason = result.reason
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error)
  }
  if (stale()) return false
  applyGuiEvents(sessionId, [{ type: 'failure', failure: reason }])
  reportLaunchIssue(sessionId, { kind: 'spawn-failed', message: reason })
  return false
}

/**
 * Figma 65: an empty GUI session runs another agent, or in another project (its main worktree). The running agent is
 * ended and its pickers cleared; the pane opens the new one (GuiPane re-runs on a new agent or folder) with that
 * agent's last picks. Once anything is said the session keeps its agent and folder: ignored.
 */
export async function retargetGuiSession(sessionId: SessionId, change: { kind?: CliAgent; worktreeId?: WorktreeId }): Promise<void> {
  if (!chatIsEmpty(guiStateOf(sessionId))) return
  await window.tr.gui.stop(sessionId).catch(() => {})
  setGuiState(sessionId, emptyGuiState())
  useWorkspace.getState().retargetSession(sessionId, change)
}
