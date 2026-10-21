// 总览批量操作 (PRD F9 v1.59): sessions picked with ⌘ / ⇧ in the overview get the same message, are stopped or are
// closed together. Pure: which picked sessions each action reaches and why the others are skipped, the bar's button
// labels and the confirmation that names what will be sent and to whom (PRD §2 — nothing is sent before it).
import type { ConfirmOptions } from './lifecycle'
import type { AgentKind, AgentPhase, SessionId, SessionStatus } from './types'

export type BatchAction = 'send' | 'stop' | 'close'

export interface BatchCandidate {
  id: SessionId
  kind: AgentKind
  title: string
  status: SessionStatus
  phase?: AgentPhase
}

export interface BatchPlan {
  action: BatchAction
  targets: BatchCandidate[]
  skipped: Array<{ candidate: BatchCandidate; reason: string }>
}

/** The native confirmation allows 500 characters per field (main/confirm-spec.ts). */
const MAX_DIALOG_TEXT = 480
const PREVIEW_CHARS = 160
export const MAX_BROADCAST_TEXT = 20_000

const isAgent = (c: BatchCandidate): boolean => c.kind === 'claude' || c.kind === 'codex'
const exited = (c: BatchCandidate): boolean => c.status === 'exited' || c.phase === 'exited'

/** Why `action` does not reach this session, or null when it does. */
function skipReason(action: BatchAction, c: BatchCandidate): string | null {
  switch (action) {
    case 'send':
      if (!isAgent(c)) return '终端不是 agent'
      return exited(c) ? '已退出' : null
    case 'stop':
      if (!isAgent(c)) return '终端不是 agent'
      return c.status === 'running' ? null : '没在运行'
    case 'close':
      return null
  }
}

export function batchPlan(action: BatchAction, candidates: readonly BatchCandidate[]): BatchPlan {
  const targets: BatchCandidate[] = []
  const skipped: BatchPlan['skipped'] = []
  for (const candidate of candidates) {
    const reason = skipReason(action, candidate)
    if (reason) skipped.push({ candidate, reason })
    else targets.push(candidate)
  }
  return { action, targets, skipped }
}

/** The bar's buttons: what they do and to how many (0 = disabled). */
export function batchButtonLabel(action: BatchAction, count: number): string {
  switch (action) {
    case 'send':
      return count > 0 ? `发送给 ${count} 个…` : '发送给 0 个'
    case 'stop':
      return `停止 ${count} 个`
    case 'close':
      return `关闭 ${count} 个`
  }
}

/** One line per reason: `跳过 2 个：终端不是 agent（终端）、已退出（修复登录）`. */
export function skippedText(plan: BatchPlan): string | null {
  if (plan.skipped.length === 0) return null
  const byReason = new Map<string, string[]>()
  for (const { candidate, reason } of plan.skipped) byReason.set(reason, [...(byReason.get(reason) ?? []), candidate.title])
  const parts = [...byReason].map(([reason, titles]) => `${reason}（${titles.join('、')}）`)
  return `跳过 ${plan.skipped.length} 个：${parts.join('；')}`
}

/** `发给：登录页、登录页 2、修复测试` — the recipients by name, as the bar and the confirmation list them. */
export function recipientsLine(plan: BatchPlan): string {
  return `${plan.action === 'send' ? '发给' : plan.action === 'stop' ? '停止' : '关闭'}：${plan.targets.map((t) => t.title).join('、')}`
}

function preview(text: string): string {
  const chars = [...text.trim().replace(/\s+/g, ' ')]
  return chars.length > PREVIEW_CHARS ? `${chars.slice(0, PREVIEW_CHARS).join('')}…` : chars.join('')
}

const clip = (text: string): string => {
  const chars = [...text]
  return chars.length > MAX_DIALOG_TEXT ? `${chars.slice(0, MAX_DIALOG_TEXT - 1).join('')}…` : text
}

/**
 * The confirmation before anything happens; null when the action reaches no session. Sending says the message and
 * every recipient, and that each one spends a turn of the user's own quota.
 */
export function batchConfirmation(plan: BatchPlan, text = ''): ConfirmOptions | null {
  const n = plan.targets.length
  if (n === 0) return null
  const skipped = skippedText(plan)
  const lines = (...parts: Array<string | null>): string => clip(parts.filter((p): p is string => p !== null).join('\n'))
  switch (plan.action) {
    case 'send':
      return {
        message: clip(`把这段话发给 ${n} 个会话并按回车？`),
        detail: lines(`“${preview(text)}”`, '', recipientsLine(plan), '每个会话各算一轮，用你自己的额度。', skipped),
        confirmLabel: `发送给 ${n} 个`,
        cancelLabel: '取消'
      }
    case 'stop':
      return {
        message: `停止 ${n} 个会话正在做的这一轮？`,
        detail: lines('向每个 agent 发送一次 Esc，和在终端里按 Esc 一样；会话和对话都还在。', recipientsLine(plan), skipped),
        confirmLabel: `停止 ${n} 个`,
        cancelLabel: '取消'
      }
    case 'close': {
      const active = plan.targets.filter((t) => t.status === 'running' || t.status === 'needs_you').length
      return {
        message: `关闭 ${n} 个会话？`,
        detail: lines(
          active > 0 ? `其中 ${active} 个正在运行或等你处理，关闭会中断它们。` : null,
          'worktree 和分支都留着。',
          recipientsLine(plan)
        ),
        confirmLabel: `关闭 ${n} 个`,
        cancelLabel: '取消',
        destructive: true
      }
    }
  }
}

/** After the action: `已发送给 3 个` / `已发送给 2 个，1 个没发出去：修复登录（终端里有确认框…）`. */
export function batchResultText(action: BatchAction, done: number, failures: ReadonlyArray<{ title: string; message: string }>): string {
  const verb = action === 'send' ? '已发送给' : action === 'stop' ? '已停止' : '已关闭'
  const head = `${verb} ${done} 个`
  if (failures.length === 0) return head
  const what = action === 'send' ? '没发出去' : action === 'stop' ? '没停下' : '没关掉'
  return `${head}，${failures.length} 个${what}：${failures.map((f) => `${f.title}（${f.message}）`).join('；')}`
}

/** ⇧-click: the ids between the anchor and the clicked one, in drawn order (just the clicked one without an anchor). */
export function rangeBetween(ordered: readonly SessionId[], anchor: SessionId | null, target: SessionId): SessionId[] {
  const to = ordered.indexOf(target)
  const from = anchor === null ? -1 : ordered.indexOf(anchor)
  if (to === -1) return []
  if (from === -1) return [target]
  return ordered.slice(Math.min(from, to), Math.max(from, to) + 1)
}

/** ⌘-click: toggles one id in the picked set, keeping the drawn order stable for display. */
export function togglePicked(picked: readonly SessionId[], id: SessionId): SessionId[] {
  return picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]
}
