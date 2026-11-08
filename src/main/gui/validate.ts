// Validation for every `window.tr.gui` payload (PRD F23). The renderer is not trusted to send well-formed data; each
// parser returns null for anything off shape or too long.

import { CLI_AGENTS, type CliAgent } from '@shared/agents'
import { AGENT_GUI } from '@shared/gui-agents'
import { GUI_MODEL_ID, isGuiPermission, type GuiAnswer, type GuiLaunch } from '@shared/gui-chat'
import { isSafeAgentSessionId } from '@shared/workspace-file'

const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/
const AGENTS: ReadonlySet<unknown> = new Set<CliAgent>(CLI_AGENTS)

export const GUI_LIMITS = {
  path: 4096,
  text: 200_000,
  attachments: 32,
  id: 128,
  message: 20_000,
  answers: 32,
  question: 4_000,
  value: 256
} as const

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !v.includes('\0')
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= GUI_LIMITS.id

export function parseGuiSessionId(value: unknown): string | null {
  return typeof value === 'string' && SESSION_ID.test(value) ? value : null
}

export function parseGuiLaunch(raw: unknown): GuiLaunch | null {
  if (!isRec(raw)) return null
  const sessionId = parseGuiSessionId(raw.sessionId)
  if (!sessionId || !text(raw.cwd, GUI_LIMITS.path) || !raw.cwd.startsWith('/')) return null
  if (!AGENTS.has(raw.agent) || !AGENT_GUI[raw.agent as CliAgent]) return null
  const launch: GuiLaunch = { sessionId, cwd: raw.cwd, agent: raw.agent as CliAgent }
  if (raw.resumeAgentSessionId !== undefined) {
    if (!isSafeAgentSessionId(raw.resumeAgentSessionId)) return null
    launch.resumeAgentSessionId = raw.resumeAgentSessionId
  }
  if (raw.model !== undefined) {
    if (typeof raw.model !== 'string' || !GUI_MODEL_ID.test(raw.model)) return null
    launch.model = raw.model
  }
  if (raw.initialPrompt !== undefined) {
    if (!text(raw.initialPrompt, GUI_LIMITS.text)) return null
    if (raw.initialPrompt.trim()) launch.initialPrompt = raw.initialPrompt
  }
  if (raw.permission !== undefined) {
    if (!isGuiPermission(raw.permission)) return null
    launch.permission = raw.permission
  }
  if (raw.plan !== undefined) {
    if (typeof raw.plan !== 'boolean') return null
    if (raw.plan) launch.plan = true
  }
  if (raw.effort !== undefined) {
    if (typeof raw.effort !== 'string' || !GUI_MODEL_ID.test(raw.effort)) return null
    launch.effort = raw.effort
  }
  if (raw.fast !== undefined) {
    if (typeof raw.fast !== 'boolean') return null
    launch.fast = raw.fast
  }
  if (raw.dispatched !== undefined) {
    if (typeof raw.dispatched !== 'boolean') return null
    if (raw.dispatched) launch.dispatched = true
  }
  return launch
}

export function parseGuiMessage(raw: unknown): { text: string; attachments: string[] } | null {
  if (!isRec(raw) || !text(raw.text, GUI_LIMITS.text) || !Array.isArray(raw.attachments)) return null
  if (raw.attachments.length > GUI_LIMITS.attachments) return null
  const attachments: string[] = []
  for (const path of raw.attachments) {
    if (!text(path, GUI_LIMITS.path) || !path.startsWith('/') || path.includes('\n')) return null
    attachments.push(path)
  }
  if (!raw.text.trim() && attachments.length === 0) return null
  return { text: raw.text, attachments }
}

const DECISIONS: ReadonlySet<unknown> = new Set(['keep-planning', 'approve-ask', 'approve-auto'])

export function parseGuiAnswer(raw: unknown): GuiAnswer | null {
  if (!isRec(raw) || !id(raw.id)) return null
  const message = raw.message
  if (message !== undefined && !text(message, GUI_LIMITS.message)) return null
  const withMessage = typeof message === 'string' ? { message } : {}
  if (raw.kind === 'permission') {
    if (!id(raw.optionId)) return null
    return { kind: 'permission', id: raw.id, optionId: raw.optionId, ...withMessage }
  }
  if (raw.kind === 'plan') {
    if (!DECISIONS.has(raw.decision)) return null
    return { kind: 'plan', id: raw.id, decision: raw.decision as Extract<GuiAnswer, { kind: 'plan' }>['decision'], ...withMessage }
  }
  if (raw.kind === 'question') {
    if (!isRec(raw.answers)) return null
    const entries = Object.entries(raw.answers)
    if (entries.length > GUI_LIMITS.answers) return null
    const answers: Record<string, string> = {}
    for (const [question, answer] of entries) {
      if (question.length > GUI_LIMITS.question || !text(answer, GUI_LIMITS.message)) return null
      answers[question] = answer
    }
    return { kind: 'question', id: raw.id, answers }
  }
  return null
}

/** A picker's id or value. */
export const parseGuiValue = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= GUI_LIMITS.value ? v : null)

/** A queued message's new text (empty removes it). */
export const parseGuiText = (v: unknown): string | null => (text(v, GUI_LIMITS.text) ? v : null)
