// Where 同任务多解's task can come from (PRD F4 v1.68, Figma 26): what the user said in a session (its prompts, from
// the hooks of Claude, Codex, Gemini, Qwen, Pi and OpenCode) and the plan its agent is waiting on (Claude's
// ExitPlanMode, Gemini / Qwen's exit_plan_mode, whose input carries the plan). Kept per window, not saved: after a
// restart the dialog starts from what is said from then on, or from text selected in the terminal.
import { create } from 'zustand'
import { looksLikeReport } from '@shared/dispatch'
import { MAX_ATTEMPT_PROMPT } from '@shared/attempt-groups'
import type { SessionId } from '@shared/types'

const MAX_PROMPTS = 30

interface State {
  prompts: Record<SessionId, string[] | undefined>
  plans: Record<SessionId, string | undefined>
}

export const useTaskSources = create<State>()(() => ({ prompts: {}, plans: {} }))

const PLAN_TOOLS: ReadonlySet<string> = new Set(['ExitPlanMode', 'exit_plan_mode'])

function addPrompt(id: SessionId, prompt: string): void {
  const text = prompt.trim()
  // Wavi's own reports are not something the user said.
  if (!text || looksLikeReport(text)) return
  useTaskSources.setState((s) => {
    const kept = [...(s.prompts[id] ?? []), text.slice(0, MAX_ATTEMPT_PROMPT)].slice(-MAX_PROMPTS)
    while (kept.length > 1 && kept.join('\n').length > MAX_ATTEMPT_PROMPT) kept.shift()
    return { prompts: { ...s.prompts, [id]: kept } }
  })
}

function setPlan(id: SessionId, plan: string | undefined): void {
  if (useTaskSources.getState().plans[id] === plan) return
  useTaskSources.setState((s) => ({ plans: { ...s.plans, [id]: plan } }))
}

/** Once per window. */
export function startTaskSources(): () => void {
  return window.tr.agent.onEvent(({ sessionId, event }) => {
    switch (event.type) {
      case 'prompt-submit':
        addPrompt(sessionId, event.prompt)
        setPlan(sessionId, undefined)
        return
      case 'tool-start':
      case 'permission-request': {
        const plan = event.input.plan
        if (PLAN_TOOLS.has(event.tool) && !event.agentId && typeof plan === 'string' && plan.trim()) setPlan(sessionId, plan.trim().slice(0, MAX_ATTEMPT_PROMPT))
        return
      }
      case 'tool-end':
        if (PLAN_TOOLS.has(event.tool)) setPlan(sessionId, undefined)
        return
      case 'stop':
      case 'stop-failure':
      case 'session-end':
        setPlan(sessionId, undefined)
        return
      default:
        return
    }
  })
}

export const promptsOf = (id: SessionId): readonly string[] => useTaskSources.getState().prompts[id] ?? []
export const planOf = (id: SessionId): string | undefined => useTaskSources.getState().plans[id]
