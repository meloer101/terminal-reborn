// Git · 变更's PR parts (PRD F16): one line above the footer with the PR, its checks and the comments nobody answered
// yet (Figma 29I: 让 Claude 处理 puts them into the agent's input line; 让 agent 修复 when the checks fail), what went
// wrong last, or — without a usable gh — how to get one.
import { prStateLabel, prThreadsPrompt, type PrThread } from '@shared/pull-requests'
import type { Session, Worktree } from '@shared/types'
import { ChecksMark } from '../../pull-requests/PrTag'
import { fixWithAgent } from '../../pull-requests/actions'
import { actionableThreads } from '../../pull-requests/auto-fix'
import { prLineText } from '../../pull-requests/auto-fix-model'
import { setPrNotice, usePr, usePullRequests } from '../../pull-requests/store'
import { ensureAgentUp } from '../../lifecycle/agent-up'
import { insertIntoTerminal } from '../../session-io'
import { useWorkspace } from '../../state/workspace'
import { agentLabel } from '../merge/model'
import ci from './CiRows.module.css'
import styles from './GitView.module.css'

const GH_HINT = {
  missing: '创建 PR 需要 GitHub CLI：装好 gh 后在终端运行 gh auth login',
  'signed-out': 'gh 还没有登录：在终端运行 gh auth login 后可以创建 PR'
} as const

export function PrStatusLine({ worktree, target }: { worktree: Worktree; target: Session | null }) {
  const gh = usePullRequests((s) => s.gh)
  const busy = usePullRequests((s) => s.busy[worktree.path])
  const notice = usePullRequests((s) => s.notice[worktree.path])
  const pr = usePr(worktree.path)
  if (notice) {
    return (
      <p className={styles.reviewStatus} data-tone={notice.tone} role="status" data-testid="pr-status">
        <span className={styles.reviewStatusText} title={notice.text}>
          {notice.text}
        </span>
      </p>
    )
  }
  if (!pr) {
    if (worktree.isMain || (gh !== 'missing' && gh !== 'signed-out')) return null
    return (
      <p className={styles.reviewStatus} data-tone="muted" role="status" data-testid="pr-status">
        <span className={styles.reviewStatusText} title={GH_HINT[gh]}>
          {GH_HINT[gh]}
        </span>
      </p>
    )
  }
  const live = pr.state === 'open' || pr.state === 'draft'
  const failing = live && pr.checks.state === 'failing'
  const threads = live ? actionableThreads(pr) : []
  const text = prLineText(pr, prStateLabel(pr.state), threads.length)
  return (
    <p className={ci.row} role="status" data-testid="pr-status">
      {live && <ChecksMark state={pr.checks.state} />}
      <span className={ci.text} title={text}>
        {text}
      </span>
      <span className={ci.spacer} />
      {threads.length > 0 && target && (
        <button
          type="button"
          className={ci.action}
          title={`把这 ${threads.length} 条评论放进 ${agentLabel(target.kind)} 的输入行，看过后按回车发送`}
          onClick={() => void handleComments(worktree.path, target, pr.number, threads)}
        >
          {`让 ${agentLabel(target.kind)} 处理`}
        </button>
      )}
      {failing && target && (
        <button
          type="button"
          className={ci.action}
          disabled={busy === 'fixing'}
          title={`把失败的检查和日志末尾放进 ${agentLabel(target.kind)} 的输入行，看过后按回车发送`}
          onClick={() => void fixWithAgent(worktree.path, target)}
        >
          {busy === 'fixing' ? '正在读取日志…' : `让 ${agentLabel(target.kind)} 修复`}
        </button>
      )}
    </p>
  )
}

/** 让 Claude 处理: puts the unresolved comments 自动修复 may act on into the agent's input line; Enter stays with the user. */
async function handleComments(worktreePath: string, target: Session, number: number, threads: PrThread[]): Promise<void> {
  try {
    useWorkspace.getState().setActiveSession(target.id)
    await ensureAgentUp(target.id)
    await insertIntoTerminal(target.id, prThreadsPrompt(number, threads))
    useWorkspace.getState().requestTerminalFocus()
  } catch (error) {
    setPrNotice(worktreePath, { tone: 'error', text: `没能交给 ${agentLabel(target.kind)}：${error instanceof Error ? error.message : String(error)}` })
  }
}
