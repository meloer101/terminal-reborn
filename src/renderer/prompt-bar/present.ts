// What the PromptBar says about a prompt. Pure, so the wording is unit-tested.
import type { PendingPrompt, PermissionDecision } from '@shared/agent-events'
import type { AgentKind } from '@shared/types'

type PermissionPrompt = Extract<PendingPrompt, { kind: 'permission' }>

const TOOL_VERB: Record<string, string> = {
  Bash: '运行命令',
  Edit: '修改文件',
  MultiEdit: '修改文件',
  Write: '修改文件',
  NotebookEdit: '修改笔记本',
  Read: '读取文件',
  Glob: '搜索文件',
  Grep: '搜索文件',
  WebFetch: '访问网页',
  WebSearch: '联网搜索',
  Task: '启动子任务',
  Agent: '启动子任务'
}

export function agentName(kind: AgentKind): string {
  return kind === 'claude' ? 'Claude' : kind === 'codex' ? 'Codex' : '智能体'
}

/** "Claude 请求运行命令" */
export function permissionTitle(prompt: PermissionPrompt, kind: AgentKind): string {
  return `${agentName(kind)} 请求${TOOL_VERB[prompt.tool] ?? `使用 ${prompt.tool}`}`
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** The command / path / pattern itself (shown mono), falling back to the hook's one-line summary. */
export function permissionDetail(prompt: PermissionPrompt): string {
  const { tool, input } = prompt
  const picked =
    tool === 'Bash'
      ? str(input['command'])
      : tool === 'Glob' || tool === 'Grep'
        ? str(input['pattern'])
        : tool === 'WebFetch'
          ? str(input['url'])
          : tool === 'WebSearch'
            ? str(input['query'])
            : (str(input['file_path']) ?? str(input['notebook_path']) ?? str(input['path']))
  return (picked ?? prompt.summary).replace(/\s+/g, ' ').trim()
}

export interface BarOption {
  /** Digit that picks it (1-based). */
  key: number
  label: string
  /** Secondary text (a question option's description). */
  description?: string
}

export interface PermissionOption extends BarOption {
  decision: PermissionDecision
}

/** 允许一次 · 总是允许 (only when the agent offered a rule) · 拒绝 — numbered in that order. */
export function permissionOptions(prompt: PermissionPrompt): PermissionOption[] {
  const all: { decision: PermissionDecision; label: string }[] = [
    { decision: 'allow-once', label: '允许一次' },
    ...(prompt.canAllowAlways ? [{ decision: 'allow-always' as const, label: '总是允许' }] : []),
    { decision: 'deny', label: '拒绝' }
  ]
  return all.map((o, i) => ({ ...o, key: i + 1 }))
}

/** "1 / 3" while several prompts are queued for the session. */
export function queueLabel(count: number): string | null {
  return count > 1 ? `1 / ${count}` : null
}
