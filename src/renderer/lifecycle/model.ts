// The cards that replace the composer when the agent is not ready for input (Figma Screen 10 · B). Pure.
import type { BlockingDialog } from '@shared/send-protocol'
import type { Session, SessionStatus } from '@shared/types'
import { hasStartChoice } from '../state/session-start-plan'
import type { LaunchIssue } from './launch-issues'
import { AGENT_NAME } from './present'

export type CardActionId = 'resume' | 'fresh' | 'restart' | 'focus'

export interface CardAction {
  id: CardActionId
  label: string
  /** The single committing action of the card (filled button, shows ↵). */
  primary?: boolean
}

export interface CardModel {
  kind: 'not-started' | 'blocked' | 'exited'
  /** StatusGlyph shape: hollow ring for waiting states, the attention dot for blocked, red for a failure. */
  glyph: SessionStatus
  title: string
  detail: string
  actions: CardAction[]
}

export const INSTALL_HINT = {
  claude: 'npm install -g @anthropic-ai/claude-code',
  codex: 'npm install -g @openai/codex'
} as const

const RESUME_COMMAND = { claude: 'claude --resume', codex: 'codex resume' } as const

type CardSession = Pick<Session, 'kind' | 'phase' | 'status' | 'title' | 'agentSessionId' | 'currentAction'>

function blockedCard(session: CardSession, dialog: BlockingDialog | null): CardModel {
  const name = AGENT_NAME[session.kind]
  const focus: CardAction[] = [{ id: 'focus', label: '聚焦终端' }]
  if (dialog === 'claude-trust') {
    return {
      kind: 'blocked',
      glyph: 'needs_you',
      title: `${name} 在等你确认是否信任此文件夹`,
      detail: '在终端里按 ↓ 再按 ↵ 选择 “Yes, I trust this folder”',
      actions: focus
    }
  }
  if (dialog === 'codex-trust') {
    return { kind: 'blocked', glyph: 'needs_you', title: `${name} 在等你确认是否信任此目录`, detail: '在终端里确认信任后会自动继续', actions: focus }
  }
  if (dialog === 'codex-update') {
    return {
      kind: 'blocked',
      glyph: 'needs_you',
      title: `${name} 在提示有新版本`,
      detail: '在终端里选择 “Skip until next version” 或更新后继续',
      actions: focus
    }
  }
  return { kind: 'blocked', glyph: 'needs_you', title: '终端里有一个提示在等你回答', detail: '在终端里回答后会自动继续', actions: focus }
}

function exitedCard(session: CardSession, issue: LaunchIssue | undefined): CardModel {
  const name = AGENT_NAME[session.kind]
  const restart: CardAction = { id: 'restart', label: '重新启动', primary: true }
  const kind = session.kind === 'shell' ? 'claude' : session.kind
  if (issue?.kind === 'missing-cli') {
    return {
      kind: 'exited',
      glyph: 'error',
      title: `没有找到 ${kind} 命令`,
      detail: `请先安装 ${name}（${INSTALL_HINT[kind]}），装好后点重新启动`,
      actions: [restart]
    }
  }
  if (issue?.kind === 'cwd-missing') {
    return { kind: 'exited', glyph: 'error', title: '项目目录不存在', detail: `${issue.path} · 恢复目录后点重新启动`, actions: [restart] }
  }
  if (issue?.kind === 'spawn-failed') {
    return { kind: 'exited', glyph: 'error', title: '无法启动终端', detail: issue.message, actions: [restart] }
  }
  const code = issue?.kind === 'agent-exit' && issue.code !== 0 ? `退出码 ${issue.code} · ` : ''
  const actions: CardAction[] = session.agentSessionId ? [{ id: 'resume', label: '恢复上次对话' }, restart] : [restart]
  return {
    kind: 'exited',
    glyph: session.status === 'error' ? 'error' : 'idle',
    title: `${name} 已退出`,
    detail: `${code}终端里现在是普通 shell`,
    actions
  }
}

/** The card to show instead of the composer, or null when the composer should be there. */
export function cardModel(input: { session: CardSession; issue?: LaunchIssue; dialog?: BlockingDialog | null }): CardModel | null {
  const { session } = input
  if (session.kind === 'shell') return null
  switch (session.phase) {
    case 'not-started':
      if (!hasStartChoice(session)) return null
      return {
        kind: 'not-started',
        glyph: 'idle',
        title: '上次的对话还没有恢复',
        detail: `将用 ${RESUME_COMMAND[session.kind]} 接上「${session.title}」的原对话`,
        actions: [
          { id: 'fresh', label: '开始新对话' },
          { id: 'resume', label: '恢复对话', primary: true }
        ]
      }
    case 'blocked':
      return blockedCard(session, input.dialog ?? null)
    case 'exited':
      return exitedCard(session, input.issue)
    default:
      return null
  }
}
