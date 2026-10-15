// What the PromptBar says about a prompt. Pure, so the wording is unit-tested.
import type { AllowAlwaysScope, PendingPrompt, PermissionDecision } from '@shared/agent-events'
import type { PermissionRule } from '@shared/permission-scope'
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

const RULE_NOUN: Record<string, string> = {
  Bash: '命令',
  Edit: '文件修改',
  MultiEdit: '文件修改',
  Write: '文件修改',
  NotebookEdit: '笔记本修改',
  Read: '文件读取',
  Glob: '文件搜索',
  Grep: '文件搜索',
  WebFetch: '网页访问',
  WebSearch: '联网搜索'
}

const MAX_SUBJECT = 32

function clip(value: string): string {
  const chars = [...value]
  return chars.length > MAX_SUBJECT ? `${chars.slice(0, MAX_SUBJECT - 1).join('')}…` : value
}

/** Last path segment, with a trailing slash for a directory ("/repo/lib/**" → "lib/"). */
function shortPath(path: string, directory: boolean): string {
  const trimmed = path.replace(/\/\*\*$|\/\*$/, '').replace(/\/+$/, '')
  const last = trimmed.split('/').pop() || trimmed || path
  return directory || trimmed !== path ? `${last}/` : last
}

/** What one rule covers, as the user would say it: "pnpm prisma", "example.com", "lib/", "文件修改". */
export function ruleSubject(rule: PermissionRule): string {
  const content = rule.content?.trim()
  if (!content) return RULE_NOUN[rule.tool] ?? rule.tool
  if (rule.tool === 'Bash') return clip(content.replace(/:\*$/, '').replace(/\s+\*$/, '').trim() || content)
  if (rule.tool === 'WebFetch') return clip(content.replace(/^domain:/, ''))
  if (content.includes('/')) return clip(shortPath(content, false))
  return clip(content)
}

/** Space between CJK and a Latin subject ("询问 prisma"), none before a CJK one ("询问文件修改"). */
const joinCjk = (head: string, subject: string): string => (/^[ -~]/.test(subject) ? `${head} ${subject}` : `${head}${subject}`)

/**
 * The "allow always" option, scoped the way the agent offered it (Figma 02 · 16:178):
 * "允许，本会话不再询问 pnpm prisma" · "允许，本项目不再询问文件修改" · "允许，本会话可访问 lib/".
 */
export function allowAlwaysLabel(scope: AllowAlwaysScope | undefined): string {
  if (!scope) return '允许，不再询问同类请求'
  const where = scope.scope === 'session' ? '本会话' : '本项目'
  const ruleSubjects = [...new Set(scope.rules.map(ruleSubject))]
  const subjects = ruleSubjects.length > 0 ? ruleSubjects : [...new Set(scope.directories.map((d) => shortPath(d, true)))]
  const head = ruleSubjects.length > 0 ? `允许，${where}不再询问` : `允许，${where}可访问`
  if (subjects.length === 0) return `允许，${where}不再询问`
  const shown = subjects.slice(0, 2).join('、') + (subjects.length > 2 ? ' 等' : '')
  return joinCjk(head, shown)
}

/** 允许 · 允许，<scope>不再询问 … (only when the agent offered a rule) · 拒绝并说明… — numbered in that order. */
export function permissionOptions(prompt: PermissionPrompt): PermissionOption[] {
  const all: { decision: PermissionDecision; label: string }[] = [
    { decision: 'allow-once', label: '允许' },
    ...(prompt.canAllowAlways ? [{ decision: 'allow-always' as const, label: allowAlwaysLabel(prompt.allowAlways) }] : []),
    { decision: 'deny', label: '拒绝并说明…' }
  ]
  return all.map((o, i) => ({ ...o, key: i + 1 }))
}

/** How many numbered options the bar shows for this prompt (a question's last one is 其他…). */
export function promptOptionCount(prompt: PendingPrompt, questionIndex = 0): number {
  if (prompt.kind === 'permission') return permissionOptions(prompt).length
  const question = prompt.questions[Math.min(questionIndex, prompt.questions.length - 1)]
  return question ? question.options.length + 1 : 0
}

/** Composer placeholder while a prompt bar is showing: "回复 Claude，或按 1–3 直接选择". */
export function replyPlaceholder(kind: AgentKind, optionCount: number): string {
  const who = agentName(kind)
  if (optionCount < 1) return `回复 ${who}`
  return optionCount === 1 ? `回复 ${who}，或按 1 直接选择` : `回复 ${who}，或按 1–${Math.min(optionCount, 9)} 直接选择`
}

/** "1 / 3" while several prompts are queued for the session. */
export function queueLabel(count: number): string | null {
  return count > 1 ? `1 / ${count}` : null
}
