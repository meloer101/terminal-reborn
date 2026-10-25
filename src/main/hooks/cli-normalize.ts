// Hook payloads of the CLIs beyond Claude Code and Codex -> the same normalized events (PRD F4 v1.68, ROADMAP 7 ②).
// Pure. Their tool vocabularies are mapped onto Claude's (Bash, Edit, Write, Read) so the status, current-action and
// check code stays agent-agnostic. None of them gets a prompt-bar answer yet: their approval dialogs are answered in
// the TUI (Gemini's hooks cannot approve at all; Qwen awaits PermissionRequest *before* drawing its dialog, so
// holding it would hide the dialog from the terminal).
// Sources (read from the CLIs' code, not measured on a live run yet):
// - Gemini CLI 0.67 nightly: packages/core/src/hooks/types.ts (events BeforeTool, AfterTool, BeforeAgent, AfterAgent,
//   Notification `ToolPermission`, SessionStart, SessionEnd); tools run_shell_command / replace / write_file / read_file.
// - Qwen Code 0.26: Claude-style events (PreToolUse, PostToolUse(Failure), PermissionRequest, Notification
//   `permission_prompt` / `idle_prompt`, UserPromptSubmit, Stop, StopFailure, SessionStart, SessionEnd); same tools,
//   `edit` instead of `replace`.
import { isSafeAgentSessionId } from '@shared/workspace-file'
import type { AgentEvent } from '@shared/agent-events'
import { classifyNotification, type NormalizedHook } from './normalize'

type Rec = Record<string, unknown>

const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined)

const NONE: NormalizedHook = { events: [], clears: 'none' }
const REPLY_TAIL_CHARS = 48_000

/** Gemini / Qwen tool names in Claude's terms; the input keeps only what the status line shows. */
export function mapGeminiTool(tool: string, rawInput: unknown): { tool: string; input: Rec } {
  const input = isRec(rawInput) ? rawInput : {}
  const path = str(input.file_path) ?? str(input.absolute_path) ?? str(input.path)
  switch (tool) {
    case 'run_shell_command': {
      const command = str(input.command)
      return { tool: 'Bash', input: command ? { command } : {} }
    }
    case 'replace':
    case 'edit':
      return { tool: 'Edit', input: path ? { file_path: path } : {} }
    case 'write_file':
      return { tool: 'Write', input: path ? { file_path: path } : {} }
    case 'read_file':
      return { tool: 'Read', input: path ? { file_path: path } : {} }
    case 'grep_search':
    case 'search_file_content':
      return { tool: 'Grep', input: str(input.pattern) ? { pattern: input.pattern } : {} }
    case 'glob':
      return { tool: 'Glob', input: str(input.pattern) ? { pattern: input.pattern } : {} }
    default:
      return { tool, input }
  }
}

function sessionStart(payload: Rec): AgentEvent {
  const id = str(payload.session_id)
  return id && isSafeAgentSessionId(id) ? { type: 'session-start', agentSessionId: id } : { type: 'session-start' }
}

const stop = (message: string | undefined): AgentEvent => (message ? { type: 'stop', message: message.slice(-REPLY_TAIL_CHARS) } : { type: 'stop' })

/** Gemini CLI. Its hooks see every turn but can never approve a call: the dialog is the TUI's. */
export function normalizeGemini(event: string, payload: Rec): NormalizedHook {
  const mapped = mapGeminiTool(str(payload.tool_name) ?? 'unknown', payload.tool_input)
  switch (event) {
    case 'SessionStart':
      return { events: [sessionStart(payload)], clears: 'none', ...(payload.source === 'clear' ? { cleared: true as const } : {}) }
    case 'BeforeAgent':
      return { events: [{ type: 'prompt-submit', prompt: str(payload.prompt) ?? '' }], clears: 'all', newTurn: true }
    case 'BeforeTool':
      return { events: [{ type: 'tool-start', tool: mapped.tool, input: mapped.input }], clears: 'none' }
    case 'AfterTool': {
      const response = isRec(payload.tool_response) ? payload.tool_response : {}
      const ok = response.error === undefined || response.error === null
      return { events: [{ type: 'tool-end', tool: mapped.tool, input: mapped.input, ok }], clears: 'tool' }
    }
    case 'Notification': {
      const message = str(payload.message) ?? ''
      // `ToolPermission` is its only kind: the approval dialog is up.
      if (payload.notification_type === 'ToolPermission') {
        const details = isRec(payload.details) ? payload.details : {}
        const tool = mapGeminiTool(str(details.tool_name) ?? str(details.name) ?? 'unknown', details.tool_input ?? details.args)
        return { events: [{ type: 'permission-request', tool: tool.tool, input: tool.input }], clears: 'none' }
      }
      return { events: [{ type: 'notification', kind: classifyNotification(undefined, message), message }], clears: 'none' }
    }
    case 'AfterAgent':
      return { events: [stop(str(payload.prompt_response))], clears: 'all' }
    case 'SessionEnd': {
      const reason = str(payload.reason)
      return { events: [{ type: 'session-end', ...(reason ? { reason } : {}) }], clears: 'all' }
    }
    default:
      return NONE
  }
}

/** Qwen Code: Claude's event names and fields, Gemini's tool names. */
export function normalizeQwen(event: string, payload: Rec): NormalizedHook {
  const mapped = mapGeminiTool(str(payload.tool_name) ?? 'unknown', payload.tool_input)
  switch (event) {
    case 'SessionStart':
      return { events: [sessionStart(payload)], clears: 'none', ...(payload.source === 'clear' ? { cleared: true as const } : {}) }
    case 'UserPromptSubmit':
      return { events: [{ type: 'prompt-submit', prompt: str(payload.prompt) ?? '' }], clears: 'all', newTurn: true }
    case 'PreToolUse':
      return { events: [{ type: 'tool-start', tool: mapped.tool, input: mapped.input }], clears: 'none' }
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return { events: [{ type: 'tool-end', tool: mapped.tool, input: mapped.input, ok: event === 'PostToolUse' }], clears: 'tool' }
    // Answered at once (no `permission` draft, so nothing holds it): Qwen draws its dialog only after this returns.
    case 'PermissionRequest':
      return { events: [{ type: 'permission-request', tool: mapped.tool, input: mapped.input }], clears: 'none' }
    case 'Notification': {
      const message = str(payload.message) ?? ''
      const type = str(payload.notification_type)
      return { events: [{ type: 'notification', kind: classifyNotification(type, message), message }], clears: 'none' }
    }
    case 'Stop':
      return { events: [stop(str(payload.last_assistant_message))], clears: 'all' }
    case 'StopFailure': {
      const message = str(payload.last_assistant_message) ?? str(payload.error)
      const reason = str(payload.error)
      return { events: [{ type: 'stop-failure', ...(message ? { message } : {}), ...(reason ? { reason } : {}) }], clears: 'all' }
    }
    case 'SessionEnd': {
      const reason = str(payload.reason)
      return { events: [{ type: 'session-end', ...(reason ? { reason } : {}) }], clears: 'all' }
    }
    default:
      return NONE
  }
}

/**
 * OpenCode and Pi report through Wavi's own plugin / extension (resources/hooks/wavi-opencode.js, wavi-pi.ts), which
 * posts Claude's event names and fields with Claude's tool names already, so they read like Qwen.
 */
export const normalizeAdapter = normalizeQwen
