// Git · 变更's PR parts (PRD F16, Figma 29R): the ship zone's headline row — what the checks say, and that they fail on
// the base too (29J), with 让 Claude 处理 for comments nobody answered (29I), 让 Claude 修复 when the checks fail and
// PR #N at the end — and the PR's facts for the zone's facts line. What went wrong last, or — without a usable gh — how
// to get one, stands in; a muted notice (a receipt such as 已创建 PR #3) only while there is no PR to show.
import { Check, CircleDashed, GitPullRequest, X } from 'lucide-react'
import { prStateLabel, prThreadsPrompt, type PrThread } from '@shared/pull-requests'
import type { Session, SessionId, Worktree } from '@shared/types'
import { fixWithAgent, openPullRequest } from '../../pull-requests/actions'
import { actionableThreads } from '../../pull-requests/auto-fix'
import { baseBrokenChecks, prHeadline } from '../../pull-requests/auto-fix-model'
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

/** The PR's headline and facts (Figma 29R), shared by the headline row and the zone's facts line. */
export function usePrLines(worktree: Worktree) {
  const pr = usePr(worktree.path)
  const automation = usePullRequests((s) => s.automation[worktree.path])
  if (!pr) return null
  const live = pr.state === 'open' || pr.state === 'draft'
  const threads = live ? actionableThreads(pr) : []
  const broken = automation?.number === pr.number ? baseBrokenChecks(automation) : []
  return { pr, live, threads, ...prHeadline(pr, prStateLabel(pr.state), threads.length, { name: worktree.baseBranch ?? 'main', checks: broken }) }
}

const MARK = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

/**
 * The ship zone's first row for a PR (Figma 29R): a mark for what the checks say, the headline in strong text, the
 * agent actions it calls for and `PR #N` at the end (opens it in the built-in browser). Notices and the gh hint stand
 * in while there is no PR to show.
 */
export function PrStatusLine({ worktree, onBase, target, openIn }: { worktree: Worktree; onBase: boolean; target: Session | null; openIn: SessionId | null }) {
  const gh = usePullRequests((s) => s.gh)
  const busy = usePullRequests((s) => s.busy[worktree.path])
  const notice = usePullRequests((s) => s.notice[worktree.path])
  const lines = usePrLines(worktree)
  const automation = usePullRequests((s) => s.automation[worktree.path])
  const noticeRow = notice && (
    <p className={styles.reviewStatus} data-tone={notice.tone} role="status" data-testid={lines ? 'pr-notice' : 'pr-status'}>
      <span className={styles.reviewStatusText} title={notice.text}>
        {notice.text}
      </span>
    </p>
  )
  if (notice && !lines) return noticeRow
  if (!lines) {
    if (onBase || (gh !== 'missing' && gh !== 'signed-out')) return null
    return (
      <p className={styles.reviewStatus} data-tone="muted" role="status" data-testid="pr-status">
        <span className={styles.reviewStatusText} title={GH_HINT[gh]}>
          {GH_HINT[gh]}
        </span>
      </p>
    )
  }
  const { pr, live, threads, headline } = lines
  const checks = live ? pr.checks.state : 'none'
  const Mark = checks === 'failing' ? X : checks === 'passing' ? Check : checks === 'pending' ? CircleDashed : GitPullRequest
  return (
    <>
    <p className={ci.headline} role="status" data-testid="pr-status">
      <span className={ci.mark} data-checks={checks}>
        <Mark {...MARK} />
      </span>
      <span className={ci.headlineText} title={headline}>
        {headline}
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
      {/* While 自动修复 waits on the decision surface, 在这里修 there is this action. */}
      {checks === 'failing' && target && !(automation?.number === pr.number && automation.run?.kind === 'stopped') && (
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
      <button type="button" className={ci.link} aria-label={`打开 PR #${pr.number}`} title={`在内置浏览器打开 ${pr.url}`} onClick={() => openPullRequest(openIn, pr.url)}>
        PR #{pr.number}
      </button>
    </p>
    {/* What went wrong last stays under the headline, so PR #N is still one click away. */}
    {notice?.tone === 'error' && noticeRow}
    </>
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
