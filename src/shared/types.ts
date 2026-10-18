// Core domain model. See docs/PRD.md §3.
// Changing these shapes affects every track — keep edits additive.

export type ProjectId = string
export type WorktreeId = string
export type SessionId = string

export type AgentKind = 'claude' | 'codex' | 'shell'

export type SessionStatus =
  | 'running' // agent is working
  | 'needs_you' // waiting on a permission prompt or a question
  | 'done_unread' // turn finished, user hasn't looked yet
  | 'idle' // finished and seen, or freshly started
  | 'error' // turn failed or process exited non-zero
  | 'exited' // process is gone

export interface Project {
  id: ProjectId
  name: string
  /** Absolute path of the main checkout. */
  rootPath: string
}

export interface Worktree {
  id: WorktreeId
  projectId: ProjectId
  branch: string
  /** Absolute path; equals Project.rootPath for the main checkout. */
  path: string
  isMain: boolean
  /** Branch this worktree was created from; diff/merge baseline. */
  baseBranch?: string
  ahead?: number
  behind?: number
  /** Line stats vs baseBranch. */
  added?: number
  removed?: number
}

/** prompt = cut from the first prompt · agent = the agent's own title · user = renamed in Wavi. Precedence user > agent > prompt. */
export type TitleSource = 'prompt' | 'agent' | 'user'

export interface Session {
  id: SessionId
  worktreeId: WorktreeId
  kind: AgentKind
  /** Task title: the agent's own name for the conversation, else the first prompt (PRD F2). */
  title: string
  /** Where `title` came from; a user rename is never replaced. Absent = the default name or a title saved before this existed. */
  titleSource?: TitleSource
  status: SessionStatus
  /** Human-readable current action, e.g. "编辑 src/auth/session.ts". */
  currentAction?: string
  /** Epoch ms. */
  startedAt: number
  lastActivityAt: number
  /**
   * The agent's own conversation id (Claude / Codex `session_id` from the SessionStart hook).
   * Persisted; used to relaunch with `--resume` after an app restart (phase 2 · A2).
   */
  agentSessionId?: string
  /** Where the agent process is in its life (transient, not persisted). See AgentPhase. */
  phase?: AgentPhase
  /** One line of the agent's last reply (the end of its last turn). Persisted. */
  lastReply?: string
  /** Epoch ms the last turn finished (Stop). Persisted. */
  finishedAt?: number
  /** Epoch ms the current status began ("已等 3m" counts from here). Transient. */
  statusSince?: number
  /** Epoch ms the current turn began (running time). Transient. */
  turnStartedAt?: number
}

/**
 * Agent process lifecycle, separate from the turn status (phase 2 · A2/A3/A6):
 * - not-started: restored after an app restart, nothing spawned yet (resumes on first view)
 * - starting: PTY spawned, waiting for the agent's SessionStart hook
 * - ready: the agent is up
 * - blocked: a first-run dialog or shell prompt is in the way (trust, update, rc-file prompt)
 * - exited: the agent is gone; the PTY may still hold a plain shell — never send prompts there
 * Shell sessions don't use phase.
 */
export type AgentPhase = 'not-started' | 'starting' | 'ready' | 'blocked' | 'exited'
