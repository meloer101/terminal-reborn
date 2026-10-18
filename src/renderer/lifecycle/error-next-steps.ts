// What an errored session offers next (phase 2b): the error in one line, "让 agent 修复" and a retry. Pure.
import type { Session } from '@shared/types'
import type { LaunchIssue } from './launch-issues'
import { AGENT_NAME } from './present'

/**
 * - resume: the agent crashed; start it again on the same conversation
 * - continue: the agent is up but its turn failed (StopFailure: rate limit, API error); ask it to go on
 * - start: it never started (spawn error); try again
 */
export type RetryKind = 'resume' | 'continue' | 'start'

export interface ErrorNextSteps {
  summary: string
  /** Whether "让 agent 修复" makes sense (only when the agent itself can do something about it). */
  canFix: boolean
  retry: RetryKind | null
}

type ErrorView = Pick<Session, 'kind' | 'status' | 'phase' | 'currentAction'>

export function errorNextSteps(session: ErrorView, issue?: LaunchIssue): ErrorNextSteps | null {
  if (issue?.kind === 'worktree-failed') return { summary: `没能创建 worktree：${issue.message}`, canFix: false, retry: null }
  if (session.kind === 'shell') return null
  if (issue?.kind === 'missing-cli') return { summary: `没有找到 ${AGENT_NAME[session.kind]} 命令，安装后重试`, canFix: false, retry: 'start' }
  if (issue?.kind === 'cwd-missing') return { summary: `项目目录不存在：${issue.path}`, canFix: false, retry: null }
  if (issue?.kind === 'spawn-failed') return { summary: `终端无法启动：${issue.message}`, canFix: false, retry: 'start' }
  if (session.status !== 'error') return null
  if (session.phase === 'exited') return { summary: session.currentAction ?? '进程异常退出', canFix: true, retry: 'resume' }
  return { summary: session.currentAction ?? '这一轮出错了', canFix: true, retry: 'continue' }
}

/** The prompt "让 agent 修复" sends: one line, so the send protocol treats it as typed text. */
export function fixPrompt(summary: string): string {
  return `刚才出错了（${summary}）。请先找出原因并修复，然后继续之前的任务。`
}

/** What "重试" sends when the agent is up but its turn failed. */
export const CONTINUE_PROMPT = '继续'
