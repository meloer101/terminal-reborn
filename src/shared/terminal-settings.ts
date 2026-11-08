// Changing a terminal session's model, effort and permission by typing into the agent's TUI, for this session only
// (PRD F22 v1.144, measured in §6.16 on Claude Code 2.1.319). Only Claude has such a way today: its pickers' `s` keeps
// a pick to the session; Enter, a number or `/model <name>` would save it as the default, so they are never used. Codex
// has one too (`/model <slug> --reasoning=…`, `/permissions :…`) but no list of its models to offer yet; Pi, Cursor and
// Grok save every change as the default. Pure: reads screens, says which keys; terminal-settings.test.ts.
import { effortLabel } from './gui-chat'
import type { SessionSettings } from './session-settings'

export const KEY = { down: '\x1b[B', up: '\x1b[A', left: '\x1b[D', right: '\x1b[C', shiftTab: '\x1b[Z', esc: '\x1b', modelPicker: '\x1bp', sessionOnly: 's' } as const

/** Claude's own names for the families its `/model` picker lists (2.1.319), in its order. */
export const CLAUDE_MODELS = ['opus', 'fable', 'sonnet', 'haiku'] as const
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
/** shift+tab's cycle, in order (2.1.319): manual → accept edits → plan → auto → manual. */
export const CLAUDE_PERMISSIONS = ['default', 'acceptEdits', 'plan', 'auto'] as const
const PERMISSION_LABELS: Record<string, string> = { default: '询问', acceptEdits: '接受编辑', plan: '计划', auto: '自动' }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** `claude-opus-5-5` → `Opus 5.5`; the family name alone when there is no version. */
export function claudeModelLabel(id: string): string {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id)
  if (m) return `${cap(m[1] ?? '')} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
  return cap(id)
}

/** The family of a model id or alias (`claude-sonnet-5-5` → sonnet), when Claude's picker lists it. */
export function claudeFamily(id: string | undefined): string | undefined {
  if (!id) return undefined
  return CLAUDE_MODELS.find((f) => id.toLowerCase().includes(f))
}

/** The permission mode the footer shows (`⏵⏵ accept edits on`, `⏸ plan mode on`, …); manual when none is shown. */
export function claudePermissionOnScreen(screen: string): string | null {
  const tail = screen.split('\n').slice(-6).join('\n')
  if (/⏵⏵ accept edits on/.test(tail)) return 'acceptEdits'
  if (/⏸ plan mode on/.test(tail)) return 'plan'
  if (/⏵⏵ auto mode on/.test(tail)) return 'auto'
  if (/⏸ manual mode on/.test(tail)) return 'default'
  return null
}

/** What Claude last reported (hooks, statusLine) and its footer: the three rows of the phone's 会话设置. */
/** A value Claude has not reported yet leaves its row out (never a guess). */
export function claudeTerminalSettings(reported: { model?: string; effort?: string; permission?: string }, running: boolean): SessionSettings | undefined {
  const items: SessionSettings['items'] = []
  const family = claudeFamily(reported.model)
  if (family && reported.model) {
    items.push({ kind: 'model', current: family, values: CLAUDE_MODELS.map((f) => ({ value: f, label: f === family ? claudeModelLabel(reported.model ?? f) : cap(f) })) })
  }
  const effort = CLAUDE_EFFORTS.find((e) => e === reported.effort)
  if (effort) items.push({ kind: 'effort', current: effort, values: CLAUDE_EFFORTS.map((e) => ({ value: e, label: effortLabel(e) })) })
  const permission = (CLAUDE_PERMISSIONS as readonly string[]).find((p) => p === reported.permission)
  if (permission) items.push({ kind: 'permission', current: permission, values: CLAUDE_PERMISSIONS.map((p) => ({ value: p, label: PERMISSION_LABELS[p] ?? p })) })
  if (items.length === 0) return undefined
  return { items, ...(running ? { locked: 'running' as const } : {}) }
}

/** The `/model` picker's rows (`❯ 2. Opus  Opus 5.5 · …`): each row's first word, and which row the cursor is on. */
export function modelPickerRows(screen: string): { names: string[]; cursor: number } | null {
  if (!/Select model/.test(screen)) return null
  const names: string[] = []
  let cursor = -1
  for (const line of screen.split('\n')) {
    const m = /^\s*(❯)?\s*\d+\.\s+(\S+)/.exec(line)
    if (!m) continue
    if (m[1]) cursor = names.length
    names.push((m[2] ?? '').toLowerCase())
  }
  return names.length > 0 && cursor >= 0 ? { names, cursor } : null
}

/** The keys that move the `/model` picker's cursor onto `family`; null when the picker does not list it. */
export function modelPickerMoves(screen: string, family: string): string | null {
  const rows = modelPickerRows(screen)
  if (!rows) return null
  const target = rows.names.indexOf(family)
  if (target < 0) return null
  const steps = target - rows.cursor
  return (steps > 0 ? KEY.down : KEY.up).repeat(Math.abs(steps))
}

/** The level under the `/effort` picker's ▲ (the levels line sits right under the ▲ line). */
export function effortOnPicker(screen: string): string | null {
  const lines = screen.split('\n')
  for (let i = 1; i < lines.length; i++) {
    const labels = lines[i] ?? ''
    if (!/\blow\s+medium\s+high\b/.test(labels)) continue
    const at = (lines[i - 1] ?? '').indexOf('▲')
    if (at < 0) return null
    let best: string | null = null
    let distance = Infinity
    for (const level of CLAUDE_EFFORTS) {
      const start = labels.search(new RegExp(`\\b${level}\\b`))
      if (start < 0) continue
      const d = Math.abs(start + level.length / 2 - at)
      if (d < distance) [best, distance] = [level, d]
    }
    return best
  }
  return null
}

/** The keys that move the `/effort` picker from what it shows to `target`; null when it shows no level. */
export function effortPickerMoves(screen: string, target: string): string | null {
  const now = effortOnPicker(screen)
  const from = CLAUDE_EFFORTS.indexOf(now as (typeof CLAUDE_EFFORTS)[number])
  const to = CLAUDE_EFFORTS.indexOf(target as (typeof CLAUDE_EFFORTS)[number])
  if (from < 0 || to < 0) return null
  const steps = to - from
  return (steps > 0 ? KEY.right : KEY.left).repeat(Math.abs(steps))
}

/** Claude asks again before switching a conversation's model ("Switch model?", 1 Yes / 2 No). */
export const isSwitchModelPrompt = (screen: string): boolean => /Switch model\?/.test(screen)
