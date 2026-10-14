// Normalized agent signals (PRD §3, F2, F3). Claude Code hooks feed these in M2; Codex hooks in M3.
// main/hooks turns raw hook payloads into these shapes; the renderer never sees raw hook JSON.
import type { SessionId } from './types'

export type HookAgent = 'claude' | 'codex'

export type AgentEvent =
  /** `agentSessionId` is the agent's conversation id (Claude/Codex `session_id`), for `--resume`. */
  | { type: 'session-start'; agentSessionId?: string }
  | { type: 'prompt-submit'; prompt: string }
  /** PreToolUse. `input` is the tool's raw input object (file_path, command, pattern, …). */
  | { type: 'tool-start'; tool: string; input: Record<string, unknown> }
  /** PostToolUse / PostToolUseFailure. */
  | { type: 'tool-end'; tool: string; input: Record<string, unknown>; ok: boolean }
  /** Notification hook, classified. 'permission' / 'question' mean the TUI is waiting on the user. */
  | { type: 'notification'; kind: 'permission' | 'question' | 'idle' | 'other'; message: string }
  | { type: 'stop' }
  | { type: 'stop-failure'; message?: string }
  | { type: 'session-end'; reason?: string }

export interface AgentEventEnvelope {
  sessionId: SessionId
  agent: HookAgent
  /** Epoch ms when main received it. */
  at: number
  event: AgentEvent
}

export type PermissionDecision = 'allow-once' | 'allow-always' | 'deny'

export interface QuestionOption {
  label: string
  description?: string
}

/** One AskUserQuestion question, as the agent presents it (options in display order). */
export interface AgentQuestion {
  header?: string
  question: string
  multiSelect: boolean
  options: QuestionOption[]
}

/** Something the agent is blocked on that the UI can answer (PromptBar, sidebar). */
export type PendingPrompt =
  | {
      kind: 'permission'
      /** Unique per request; answer with AgentApi.respondPermission. */
      id: string
      sessionId: SessionId
      tool: string
      input: Record<string, unknown>
      /** One-line human summary, e.g. "运行 pnpm test src/auth". */
      summary: string
      /** The agent offered a rule the user can persist ("总是允许"). */
      canAllowAlways: boolean
      createdAt: number
    }
  | {
      kind: 'question'
      id: string
      sessionId: SessionId
      questions: AgentQuestion[]
      createdAt: number
    }

export interface PromptResolution {
  id: string
  sessionId: SessionId
  /** gui = answered in our UI; terminal = answered in the TUI; timeout = fell back to the TUI prompt. */
  by: 'gui' | 'terminal' | 'timeout' | 'session-ended'
}
