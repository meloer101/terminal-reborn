// Git · 变更's PR parts (PRD F16): the footer's PR button — 提交并创建 PR / 创建 PR / 提交并推送 / 推送到 PR #N /
// 打开 PR #N by the worktree's git state (v1.68, ship-model) — and one line above the footer with the PR and its checks
// (让 agent 修复 when they fail), what went wrong last, or — without a usable gh — how to get one.
import { checksLabel, prReviewSummary, prStateLabel } from '@shared/pull-requests'
import type { Session, SessionId, Worktree } from '@shared/types'
import { ChecksMark } from '../../pull-requests/PrTag'
import { fixWithAgent, openPullRequest } from '../../pull-requests/actions'
import { openCreatePr } from '../../pull-requests/create-sheet'
import { shipAction } from '../../pull-requests/ship-model'
import { usePr, usePrStatus, usePullRequests } from '../../pull-requests/store'
import { agentLabel } from '../merge/model'
import styles from './GitView.module.css'

const BUSY_LABEL = { committing: '正在提交…', pushing: '正在推送…', creating: '正在创建 PR…' } as const

const GH_HINT = {
  missing: '创建 PR 需要 GitHub CLI：装好 gh 后在终端运行 gh auth login',
  'signed-out': 'gh 还没有登录：在终端运行 gh auth login 后可以创建 PR'
} as const

export function PrButton({
  worktree,
  projectRoot,
  title,
  sessionId,
  agent,
  uncommitted
}: {
  worktree: Worktree
  projectRoot: string | null
  title: string
  sessionId: SessionId | null
  /** The worktree's agent session (its turn checks and review go into the PR body). */
  agent: Session | null
  /** Uncommitted files in the worktree: the button commits them first. */
  uncommitted: number
}) {
  const gh = usePullRequests((s) => s.gh)
  const busy = usePullRequests((s) => s.busy[worktree.path])
  const status = usePrStatus(worktree.path)
  const pr = usePr(worktree.path)
  const openPr = pr && (pr.state === 'open' || pr.state === 'draft') ? pr : null
  const local = status?.local
  const unpushed = Boolean(openPr?.details && local && !local.remoteAhead && local.head !== openPr.details.headOid)
  const action = shipAction({ uncommitted, openPr, unpushed })
  if (action.kind === 'open' && openPr) {
    return (
      <button type="button" className={styles.ghostButton} title={`在内置浏览器打开 ${openPr.url}`} onClick={() => openPullRequest(sessionId, openPr.url)}>
        {action.label}
      </button>
    )
  }
  const mode = action.kind === 'sheet' ? action.mode : 'pr'
  const reason = worktree.isMain
    ? '项目主目录没有要提 PR 的分支'
    : gh === 'checking'
      ? '正在检查 gh…'
      : gh !== 'ready'
        ? GH_HINT[gh]
        : !projectRoot
          ? '找不到这个 worktree 的项目'
          : null
  return (
    <button
      type="button"
      className={styles.ghostButton}
      disabled={reason !== null || Boolean(busy && busy !== 'fixing')}
      title={
        reason ??
        (mode === 'push'
          ? `${uncommitted > 0 ? '看过要提交的文件和说明后提交，' : ''}推送到 PR #${openPr?.number ?? ''}`
          : `${uncommitted > 0 ? '看过要提交的文件和说明后提交，' : ''}写好标题和正文后推送分支，用 gh 创建 PR，然后在内置浏览器打开`)
      }
      onClick={() =>
        projectRoot &&
        openCreatePr({
          root: projectRoot,
          worktree: worktree.path,
          title,
          sessionId,
          agentSessionId: agent?.id ?? null,
          agent: agent?.kind === 'claude' || agent?.kind === 'codex' ? agent.kind : null,
          mode,
          openPr: openPr ? { number: openPr.number, url: openPr.url } : null
        })
      }
    >
      {busy && busy !== 'fixing' ? BUSY_LABEL[busy] : action.label}
    </button>
  )
}

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
  if (busy && busy !== 'fixing') {
    return (
      <p className={styles.reviewStatus} role="status" data-testid="pr-status">
        <span className={styles.reviewStatusText}>{busy === 'committing' ? '正在提交…' : busy === 'pushing' ? '正在推送…' : '正在推送分支并创建 PR…'}</span>
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
  const pending = live && pr.details ? prReviewSummary(pr.details) : ''
  const text = [`PR #${pr.number}`, prStateLabel(pr.state), ...(live ? [checksLabel(pr.checks)] : []), ...(pending ? [pending] : [])].join(' · ')
  return (
    <p className={styles.reviewStatus} role="status" data-testid="pr-status">
      {live && <ChecksMark state={pr.checks.state} />}
      <span className={styles.reviewStatusText} title={text}>
        {text}
      </span>
      {failing && target && (
        <button
          type="button"
          className={styles.noteAction}
          disabled={busy === 'fixing'}
          title={`把失败的检查和日志末尾放进 ${agentLabel(target.kind)} 的输入行，看过后按回车发送`}
          onClick={() => void fixWithAgent(worktree.path, target)}
        >
          {busy === 'fixing' ? '正在读取日志…' : '让 agent 修复'}
        </button>
      )}
    </p>
  )
}
