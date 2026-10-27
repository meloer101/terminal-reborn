// Git · 变更's PR parts (PRD F16): one line above the footer with the PR, its checks and the comments nobody answered
// yet (Figma 29I: 让 Claude 处理 puts them into the agent's input line; 让 agent 修复 when the checks fail), what went
// wrong last, or — without a usable gh — how to get one.
//
// LEGACY: PrButton, the footer's PR button (提交并创建 PR / 推送到 PR #N / 打开 PR #N by ship-model), is replaced by
// the two exits of Figma 29A; delete it with its import in ChangesView.
import { prStateLabel, prThreadsPrompt, type PrThread } from '@shared/pull-requests'
import type { Session, SessionId, Worktree } from '@shared/types'
import { ChecksMark } from '../../pull-requests/PrTag'
import { fixWithAgent, openPullRequest } from '../../pull-requests/actions'
import { actionableThreads } from '../../pull-requests/auto-fix'
import { prLineText } from '../../pull-requests/auto-fix-model'
import { openCreatePr } from '../../pull-requests/create-sheet'
import { shipAction } from '../../pull-requests/ship-model'
import { setPrNotice, usePr, usePrStatus, usePullRequests } from '../../pull-requests/store'
import { ensureAgentUp } from '../../lifecycle/agent-up'
import { insertIntoTerminal } from '../../session-io'
import { useWorkspace } from '../../state/workspace'
import { agentLabel } from '../merge/model'
import ci from './CiRows.module.css'
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
