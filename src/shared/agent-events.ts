// Normalized agent signals (PRD §3, F2, F3). Claude Code hooks feed these in M2; Codex hooks in M3.
// main/hooks turns raw hook payloads into these shapes; the renderer never sees raw hook JSON.
import type { AllowAlwaysScope } from './permission-scope'
import type { ContextUsage } from './session-meta'
import type { TodoItem } from './todo-progress'
import type { TurnChecks } from './turn-checks'
import type { SessionId } from './types'

export type { AllowAlwaysScope } from './permission-scope'

export type HookAgent = 'claude' | 'codex'

export type AgentEvent =
  /** `agentSessionId` is the agent's conversation id (Claude/Codex `session_id`), for `--resume`. */
  | { type: 'session-start'; agentSessionId?: string }
  | { type: 'prompt-submit'; prompt: string }
  /**
   * PreToolUse. `input` is the tool's raw input object (file_path, command, pattern, …). `agentId` is set when a
   * subagent made the call (Claude's `agent_id`: a Task-tool worker, an in-process teammate); absent on the main thread.
   */
  | { type: 'tool-start'; tool: string; input: Record<string, unknown>; agentId?: string }
  /** PostToolUse / PostToolUseFailure. */
  | { type: 'tool-end'; tool: string; input: Record<string, unknown>; ok: boolean; agentId?: string }
  /** PermissionRequest: the agent's own dialog for this call is up (answered in the TUI; PRD §6.6 / §6.7). */
  | { type: 'permission-request'; tool: string; input: Record<string, unknown>; agentId?: string }
  /** SubagentStop: that subagent is done, so nothing of it can still be waiting on the user. */
  | { type: 'subagent-stop'; agentId: string }
  /** Notification hook, classified. 'permission' / 'question' mean the TUI is waiting on the user. */
  | { type: 'notification'; kind: 'permission' | 'question' | 'idle' | 'other'; message: string }
  /** `message` is the agent's last reply of the turn (Claude / Codex `last_assistant_message`), possibly truncated. */
  | { type: 'stop'; message?: string }
  /**
   * The turn ended on an API error (Claude StopFailure). `reason` is Claude's error kind (`rate_limit`, `overloaded`,
   * `authentication_failed`, …); `rate_limit` also covers transient 429s, so a plan-limit stop needs the plan usage
   * too (PRD §6.6, F11).
   */
  | { type: 'stop-failure'; message?: string; reason?: string }
  | { type: 'session-end'; reason?: string }
  /** The agent's own name for the conversation (Claude `ai-title` / `custom-title`, Codex `thread_name`), read by main. Not a hook. */
  | { type: 'agent-title'; title: string }
  /** How full the context window is (Claude statusLine, Codex rollout `token_count`; PRD F11); null after /clear. Not activity. */
  | { type: 'context'; context: ContextUsage | null }
  /** The agent's todo list after a todo-tool call; [] after /clear (PRD F12). Not activity. */
  | { type: 'todos'; items: TodoItem[] }
  /**
   * The tests / lint / typecheck / builds the agent ran this turn and how they came out, read by main from its Bash
   * calls (PRD F9 / F4 “这一轮跑过哪些检查”); sent when it changes. Not activity.
   */
  | { type: 'checks'; checks: TurnChecks }
  /** An agent started by hand in a plain terminal ended (resources/hooks/agent-shim.sh): its metrics are gone. */
  | { type: 'agent-exit' }
  /**
   * Whether the agent bills the vendor's plan (its subscription login) or something else: a third-party endpoint such
   * as one CC Switch writes into ~/.claude/settings.json, a cloud provider, a custom Codex model provider. Off the
   * plan, the account's plan usage says nothing about this session (PRD F11). Not activity.
   */
  | { type: 'billing'; plan: boolean }

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
      /** What "总是允许" would allow (phase 2b · B12); absent when the suggestions could not be described. */
      allowAlways?: AllowAlwaysScope
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

/** Why an agent session runs without our hooks (status then falls back to terminal titles). */
export type HooksUnavailableReason = 'server-unavailable' | 'codex-not-installed' | 'codex-probe-failed'

/**
 * Whether the app-wide hook server is reachable (phase 2a · A8/A9). The UI shows "hooks 不可用 · 状态仅按标题判断"
 * while `ok` is false. `detail` is an English diagnostic for logs / tooltips, not UI copy.
 */
export type HooksHealth = { ok: true } | { ok: false; reason: 'server-unavailable'; detail: string }

/** Per-session hook signals from main. Receiving any AgentEvent for the session withdraws a pending 'start-timeout'. */
export type SessionHooksSignal =
  /** Sent at launch: this agent session was started without hooks. */
  | { sessionId: SessionId; kind: 'unavailable'; reason: HooksUnavailableReason; detail?: string }
  /** Hooks are attached but nothing (not even SessionStart) arrived `afterMs` after launch: a trust / update prompt may be blocking the agent. */
  | { sessionId: SessionId; kind: 'start-timeout'; afterMs: number }
