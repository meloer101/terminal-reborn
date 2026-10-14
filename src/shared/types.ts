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

export interface Session {
  id: SessionId
  worktreeId: WorktreeId
  kind: AgentKind
  /** Task title; defaults to the first prompt. */
  title: string
  status: SessionStatus
  /** Human-readable current action, e.g. "编辑 src/auth/session.ts". */
  currentAction?: string
  /** Epoch ms. */
  startedAt: number
  lastActivityAt: number
  /** The agent's own conversation id (hook `session_id`), used to resume after a restart. */
  agentSessionId?: string
}
