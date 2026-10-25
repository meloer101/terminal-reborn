// What Git · 变更's PR button does (PRD F16 v1.68), from the worktree's git state and its PR — the same table T3 Code
// uses for its one button, minus the parts Wavi does elsewhere (pull, rebase): uncommitted work is committed first,
// a branch with an open PR is pushed to it, and only a branch with nothing left to send just opens its PR.
import { commitSubject, prBody } from '@shared/pull-requests'

export type ShipMode = 'pr' | 'push'

export type ShipAction =
  /** Opens 创建 PR 面板; `commit`: it starts with 提交. */
  | { kind: 'sheet'; mode: ShipMode; commit: boolean; label: string }
  | { kind: 'open'; number: number; label: string }

export interface ShipState {
  /** Uncommitted files (untracked ones past the list's cap included). */
  uncommitted: number
  /** The branch's open (or draft) PR. */
  openPr: { number: number } | null
  /** The open PR's head is not the local head, and the PR has nothing the branch lacks: there is something to push. */
  unpushed: boolean
}

export function shipAction(state: ShipState): ShipAction {
  const commit = state.uncommitted > 0
  if (!state.openPr) return { kind: 'sheet', mode: 'pr', commit, label: commit ? '提交并创建 PR' : '创建 PR' }
  if (commit) return { kind: 'sheet', mode: 'push', commit, label: '提交并推送' }
  if (state.unpushed) return { kind: 'sheet', mode: 'push', commit, label: `推送到 PR #${state.openPr.number}` }
  return { kind: 'open', number: state.openPr.number, label: `打开 PR #${state.openPr.number}` }
}

/** The sheet's primary button. */
export function shipButtonLabel(mode: ShipMode, committing: boolean): string {
  if (mode === 'push') return committing ? '提交并推送' : '推送'
  return committing ? '提交并创建 PR' : '创建 PR'
}

/**
 * Why the sheet cannot go ahead, or null. `ticked`: files ticked for 提交; `ahead`: commits the branch has over the
 * base; `unpushed`: commits not on the upstream yet (null: never pushed).
 */
export function shipBlocker(input: {
  mode: ShipMode
  ticked: number
  message: string
  title: string
  ahead: number
  unpushed: number | null
  remoteAhead: number
  remote: string
}): string | null {
  if (input.remoteAhead > 0) return `${input.remote} 上的分支有 ${input.remoteAhead} 个本地没有的提交：先拉取或 rebase`
  if (input.ticked > 0 && !commitSubject(input.message)) return '写一句提交说明'
  if (input.mode === 'pr' && !input.title.trim()) return '写一个标题'
  if (input.ticked === 0) {
    if (input.mode === 'pr' && input.ahead === 0) return '没有比基线新的提交：勾选要提交的文件'
    if (input.mode === 'push' && input.unpushed === 0) return '没有要推送的提交'
  }
  return null
}

/** The body 创建 PR 面板 starts from without a template: the commit subjects, the one about to be made last. */
export function autoBody(subjects: readonly string[], pendingMessage: string | null): string {
  const pending = pendingMessage === null ? '' : commitSubject(pendingMessage)
  return prBody(pending ? [...subjects, pending] : subjects)
}
