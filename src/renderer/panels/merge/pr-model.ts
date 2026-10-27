// 合并到 GitHub PR (PRD F16 v1.63, Figma 22C / 22D), the pure part: the checklist from the PR as main last read it,
// what stops a merge now, and whether 合并 becomes 检查通过后合并. GitHub's branch protection still has the last word.
import { AUTO_MERGE_OFF, type MergeMethod, type PrStatus } from '@shared/pull-requests'
import type { CheckLine } from './model'

export interface PrMergeView {
  lines: CheckLine[]
  /** Reasons 合并 cannot be pressed (main refuses the same). Empty: GitHub decides. */
  blockers: string[]
  /** Checks still run, or local commits must be pushed first: the button is 检查通过后合并 (GitHub auto-merge). */
  waitForChecks: boolean
  methods: MergeMethod[]
  defaultMethod: MergeMethod
}

const short = (oid: string): string => oid.slice(0, 7)

/** `agent`: the session's agent (Claude / Codex) that the conflict line names. */
export function prMergeView(status: PrStatus, agent = 'agent'): PrMergeView | null {
  const pr = status.pr
  const details = pr?.details
  if (!pr || !details) return null
  const lines: CheckLine[] = []
  const blockers: string[] = []
  // Checks: the required ones when branch protection names some, else every check.
  const required = details.required
  if (required.total > 0) {
    if (required.failing.length > 0) {
      lines.push({ tone: 'error', text: `必需的检查没通过：${required.failing.slice(0, 3).join('、')}` })
      blockers.push('必需的检查没通过')
    } else if (required.pending > 0) lines.push({ tone: 'working', text: '必需的检查还在跑', meta: `${required.total - required.pending}/${required.total}` })
    else lines.push({ tone: 'ok', text: '必需的检查通过', meta: `${required.total}/${required.total}` })
  } else if (pr.checks.state === 'failing') lines.push({ tone: 'warn', text: `${pr.checks.failing.length} 项检查失败（不是必需的）`, meta: pr.checks.failing[0]?.name })
  else if (pr.checks.state === 'pending') lines.push({ tone: 'working', text: '检查还在跑', meta: `${pr.checks.passed}/${pr.checks.total}` })
  else if (pr.checks.state === 'passing') lines.push({ tone: 'ok', text: '检查通过', meta: `${pr.checks.total}/${pr.checks.total}` })
  else lines.push({ tone: 'warn', text: '这个 PR 没有检查' })

  // Is the PR the code the user has here?
  const local = status.local
  let unpushed = false
  if (!local) lines.push({ tone: 'warn', text: '没能对比本地分支和 PR' })
  else if (local.remoteAhead) {
    lines.push({ tone: 'error', text: 'PR 上有本地没有的提交：先拉取，看过再合并' })
    blockers.push('PR 上有本地没有的提交')
  } else if (local.head !== details.headOid) {
    unpushed = true
    lines.push({ tone: 'warn', text: '本地有还没推送的提交：合并时先推送，检查重新跑完再合并', meta: short(local.head) })
  } else lines.push({ tone: 'ok', text: '本地和 PR 是同一份代码', meta: short(details.headOid) })

  if (details.mergeState === 'dirty') {
    lines.push({ tone: 'error', text: `和基线冲突：先让 ${agent} rebase` })
    blockers.push('和基线冲突')
  } else if (details.mergeState === 'behind') lines.push({ tone: 'warn', text: '基线已前进，分支保护可能要求先更新' })

  const asks: string[] = []
  if (details.reviewDecision === 'review-required') asks.push('需要审批')
  else if (details.reviewDecision === 'changes-requested') asks.push('有人要求修改')
  if (details.threads.length > 0) asks.push(`${details.threads.length} 条评论没解决`)
  if (asks.length > 0) lines.push({ tone: 'warn', text: asks.join(' · '), meta: '只提示' })
  else if (details.reviewDecision === 'approved') lines.push({ tone: 'ok', text: '已审批' })

  if (pr.state === 'draft') blockers.push('PR 还是草稿：先在 GitHub 上标记为可审阅')
  if (details.inMergeQueue) blockers.push('已经在合并队列里')
  const waitForChecks = !blockers.length && (unpushed || (required.total > 0 ? required.pending > 0 : pr.checks.state === 'pending'))
  // 检查通过后合并 is GitHub auto-merge only; Wavi does not wait for the checks itself.
  if (waitForChecks && !details.repo.autoMergeAllowed) blockers.push(AUTO_MERGE_OFF)
  return { lines, blockers, waitForChecks, methods: details.repo.methods, defaultMethod: details.repo.defaultMethod }
}

export const METHOD_LABEL: Record<MergeMethod, string> = { squash: 'Squash', merge: 'Merge', rebase: 'Rebase' }
