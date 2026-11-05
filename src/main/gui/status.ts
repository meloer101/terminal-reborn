// What a GUI session without hooks (Codex app-server, ACP; PRD F23) tells the status machine: the same AgentEvents
// the hook bridge sends for a TUI (normalize.ts), derived from the session's GuiEvents, so the sidebar, overview,
// notifications and Dock badge treat it like any other session (PRD §3.1). Claude GUI sessions keep their hooks and
// do not use this. Pure.

import type { AgentEvent } from '@shared/agent-events'
import type { GuiEvent, GuiPrompt } from '@shared/gui-chat'

/** The tool input the 当前动作 line reads (current-action.ts), rebuilt from a chat item's name and argument. */
export function toolInputOf(tool: string, arg: string): Record<string, unknown> {
  if (!arg) return {}
  switch (tool) {
    case 'Bash':
      return { command: arg }
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'Delete':
    case 'Move':
      return { file_path: arg }
    case 'Search':
    case 'Grep':
    case 'Glob':
      return { pattern: arg }
    case 'WebSearch':
      return { query: arg }
    case 'Fetch':
    case 'WebFetch':
      return { url: arg }
    default:
      return { description: arg }
  }
}

function promptCall(prompt: GuiPrompt): { tool: string; input: Record<string, unknown>; event: AgentEvent } {
  if (prompt.kind === 'question') {
    const input = { questions: prompt.questions }
    // AskUserQuestion's PreToolUse is what makes a TUI session "等你回答".
    return { tool: 'AskUserQuestion', input, event: { type: 'tool-start', tool: 'AskUserQuestion', input } }
  }
  if (prompt.kind === 'plan') {
    const input = { plan: prompt.plan }
    return { tool: 'ExitPlanMode', input, event: { type: 'permission-request', tool: 'ExitPlanMode', input } }
  }
  const input = toolInputOf(prompt.tool, prompt.detail)
  return { tool: prompt.tool, input, event: { type: 'permission-request', tool: prompt.tool, input } }
}

export interface GuiStatusTracker {
  /** The agent is up (`agentSessionId`: Codex thread id, ACP session id). */
  started(agentSessionId?: string): AgentEvent[]
  /** A message went to the agent: a new turn (UserPromptSubmit). */
  sent(text: string): AgentEvent[]
  /** What the session's GuiEvents say: tools starting and ending, permissions and questions asked and answered. */
  events(events: readonly GuiEvent[]): AgentEvent[]
  /** The turn ended (Stop / StopFailure); `message` overrides the last reply as the failure's text. */
  turnEnd(outcome: { failed: boolean; message?: string }): AgentEvent[]
  /** The agent process ended. */
  exit(): AgentEvent[]
}

export function createGuiStatusTracker(): GuiStatusTracker {
  /** By chat item id: the last state seen of each tool row. */
  const tools = new Map<string, 'running' | 'done'>()
  const prompts = new Map<string, { tool: string; input: Record<string, unknown> }>()
  let lastReply: string | undefined

  return {
    started: (agentSessionId) => [{ type: 'session-start', ...(agentSessionId ? { agentSessionId } : {}) }],
    sent(text) {
      lastReply = undefined
      return [{ type: 'prompt-submit', prompt: text }]
    },
    events(events) {
      const out: AgentEvent[] = []
      for (const event of events) {
        if (event.type === 'items') {
          for (const { item } of event.changes) {
            if (item.kind === 'text') lastReply = item.text
            if (item.kind !== 'tool') continue
            const seen = tools.get(item.id)
            const input = toolInputOf(item.name, item.arg)
            if (item.state === 'running') {
              if (seen === undefined) out.push({ type: 'tool-start', tool: item.name, input })
              tools.set(item.id, 'running')
              continue
            }
            if (seen === 'done') continue
            // Finished without a running state first (a fast call): it still was the current action for a moment.
            if (seen === undefined) out.push({ type: 'tool-start', tool: item.name, input })
            out.push({ type: 'tool-end', tool: item.name, input, ok: item.state === 'ok' })
            tools.set(item.id, 'done')
          }
        } else if (event.type === 'prompt') {
          if (prompts.has(event.prompt.id)) continue
          const call = promptCall(event.prompt)
          prompts.set(event.prompt.id, { tool: call.tool, input: call.input })
          out.push(call.event)
        } else if (event.type === 'prompt-done') {
          const call = prompts.get(event.id)
          if (!call) continue
          prompts.delete(event.id)
          // Answered (or withdrawn): the ask is gone, like the PostToolUse of the call it was about.
          out.push({ type: 'tool-end', tool: call.tool, input: call.input, ok: true })
        } else if (event.type === 'busy' && !event.busy) {
          // A turn that ends takes its asks with it (applyGuiEvent drops the prompts too).
          prompts.clear()
        }
      }
      return out
    },
    turnEnd({ failed, message }) {
      prompts.clear()
      const reply = lastReply
      lastReply = undefined
      const text = message ?? reply
      if (failed) return [{ type: 'stop-failure', ...(text ? { message: text } : {}) }]
      return [{ type: 'stop', ...(reply ? { message: reply } : {}) }]
    },
    exit() {
      prompts.clear()
      tools.clear()
      return [{ type: 'session-end', reason: 'exit' }]
    }
  }
}
