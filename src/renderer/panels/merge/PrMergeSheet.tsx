// 合并到 GitHub PR (PRD F16 v1.63, Figma 22C 364:14009 / 22D 369:14631): the PR's checklist as main last read it —
// checks, whether the PR is the code here, conflicts, approvals and threads (those only inform), Wavi's review and the
// agent's own checks — then the methods the repository allows, removing the remote branch and archiving. 合并 is pinned
// to the head main checked; while checks run it becomes 检查通过后合并 (GitHub auto-merge, else Wavi waits).
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { ArrowRight, CircleX, GitBranch } from 'lucide-react'
import { severityCounts } from '@shared/background-review'
import type { MergeMethod, PrStatus } from '@shared/pull-requests'
import { archiveTargetFor, archiveWorktree } from '../../archive/actions'
import { loadSavedReview, reviewLine, startBackgroundReview, useBackgroundReview } from '../../review/background'
import { useSettings } from '../../settings/useSettings'
import { useReviewComments } from '../../state/review-comments'
import { useWorkspace } from '../../state/workspace'
import { useTurnCheckView } from '../../turn-checks/TurnChecksTag'
import { Segmented } from '../../ui/Segmented'
import { agentSessionFor, type CheckLine } from './model'
import { Checkbox, Line, TurnChecks } from './parts'
import { METHOD_LABEL, prMergeView } from './pr-model'
import { closeMergeSheet, type MergeTarget } from './store'
import styles from './MergeSheet.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

type Phase = { kind: 'ready' } | { kind: 'merging' } | { kind: 'done'; lines: CheckLine[] }

export function PrMergeSheet({ target, status, targetSwitch }: { target: MergeTarget; status: PrStatus; targetSwitch: ReactNode }) {
  const titleId = useId()
  const sheetRef = useRef<HTMLDivElement>(null)
  const view = prMergeView(status)
  const pr = status.pr!
  const details = pr.details!
  const [method, setMethod] = useState<MergeMethod>(view?.defaultMethod ?? 'squash')
  const [deleteRemote, setDeleteRemote] = useState(false)
  const { settings, loaded } = useSettings()
  const [archiveAfter, setArchiveAfter] = useState<boolean | null>(null)
  const archive = archiveAfter ?? settings.archive.afterMerge
  const [phase, setPhase] = useState<Phase>({ kind: 'ready' })
  const [failure, setFailure] = useState<string | null>(null)

  const ids = target.worktreeIds
  const sessions = useWorkspace((s) => s.sessions)
  const activeId = useWorkspace((s) => s.activeSessionId)
  const agent = agentSessionFor(
    sessions.filter((s) => ids.includes(s.worktreeId)),
    activeId
  )
  const reviewAgent = agent && (agent.kind === 'claude' || agent.kind === 'codex') ? agent.kind : null
  const review = useBackgroundReview((s) => s.byRoot[target.worktreePath])
  const reviewComments = useReviewComments((s) => s.byRoot[target.worktreePath])
  const checksView = useTurnCheckView(agent?.id)
  useEffect(() => loadSavedReview(target.worktreePath), [target.worktreePath])
  // 合并前审阅 also before a PR merge (main skips a diff it already reviewed).
  const autoReview = loaded && settings.review.mode === 'builtin' && settings.review.beforeMerge
  useEffect(() => {
    if (autoReview && reviewAgent) void startBackgroundReview(target.worktreePath, reviewAgent, 'merge').catch(() => {})
  }, [autoReview, reviewAgent, target.worktreePath])
  useEffect(() => sheetRef.current?.focus(), [])

  if (!view) return null
  const reviewCheck = review ? reviewLine(review, severityCounts((reviewComments ?? []).filter((c) => c.origin === 'review')), reviewAgent ?? undefined) : null
  const busy = phase.kind === 'merging'
  const blocked = view.blockers.length > 0
  const methods = view.methods.length > 0 ? view.methods : (['merge'] as MergeMethod[])

  const merge = async (): Promise<void> => {
    if (blocked || busy) return
    setFailure(null)
    setPhase({ kind: 'merging' })
    const when = view.waitForChecks ? 'when-ready' : 'now'
    let result
    try {
      result = await window.tr.pr.merge({ root: target.root, worktree: target.worktreePath, method, when, deleteRemoteBranch: deleteRemote && when === 'now' })
    } catch (error) {
      result = { ok: false as const, reason: 'failed' as const, message: error instanceof Error ? error.message : String(error) }
    }
    if (!result.ok) {
      if (result.reason !== 'declined') setFailure(result.message)
      setPhase({ kind: 'ready' })
      return
    }
    const lines: CheckLine[] = [{ tone: result.outcome === 'merged' ? 'ok' : 'working', text: result.message }]
    if (archive && !target.isMain && ids[0]) {
      if (result.outcome === 'merged') {
        const archiveTarget = archiveTargetFor(ids[0])
        const archived = archiveTarget
          ? await archiveWorktree(archiveTarget, { ignoreScriptFailure: true }).catch((error: unknown) => ({
              ok: false as const,
              message: error instanceof Error ? error.message : String(error)
            }))
          : null
        if (archived?.ok) lines.push({ tone: 'ok', text: '已归档 worktree，可以在跳转（⌘K）的历史里恢复' })
        else if (archived) lines.push({ tone: 'warn', text: `没有归档：${archived.message}` })
      } else lines.push({ tone: 'warn', text: '还没合并，所以没有归档：合并后在 Worktree 视图里归档' })
    }
    setPhase({ kind: 'done', lines })
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      closeMergeSheet(true)
    } else if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault()
      if (phase.kind === 'done') closeMergeSheet(true)
      else void merge()
    }
  }
  const onScrim = (event: MouseEvent): void => {
    if (event.target === event.currentTarget && !busy) closeMergeSheet(true)
  }

  const who = view.waitForChecks
    ? details.repo.autoMergeAllowed
      ? '检查通过后由 GitHub 合并'
      : '由 Wavi 等检查通过再合并（Wavi 要开着）'
    : `以 @${details.viewer || '你的账号'} 合并 · 分支保护照样由 GitHub 执行`

  return (
    <div className={styles.scrim} onMouseDown={onScrim} data-region="merge">
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="merge-sheet"
        data-target="pr"
      >
        <header className={styles.context}>
          <div className={styles.titleRow}>
            <h2 id={titleId} className={styles.title}>
              合并到
            </h2>
            {targetSwitch}
          </div>
          <p className={styles.branches}>
            <GitBranch {...ICON} />
            <span>{status.branch}</span>
            <ArrowRight {...ICON} />
            <span>PR #{pr.number}</span>
          </p>
        </header>

        <div className={styles.checks} aria-live="polite">
          {phase.kind === 'done'
            ? phase.lines.map((line) => <Line key={line.text} line={line} />)
            : view.lines.map((line) => <Line key={line.text} line={line} />)}
          {phase.kind !== 'done' && reviewCheck && (
            <Line line={{ tone: reviewCheck.tone === 'muted' ? 'warn' : reviewCheck.tone, text: reviewCheck.text, ...(reviewCheck.meta ? { meta: reviewCheck.meta } : {}) }} />
          )}
          {phase.kind !== 'done' && agent && checksView && <TurnChecks view={checksView} kind={agent.kind} />}
        </div>

        {phase.kind !== 'done' && !blocked && (
          <div className={styles.options}>
            <div className={styles.field} role="group" aria-label="合并方式">
              <span className={styles.label}>合并方式</span>
              <div className={styles.control}>
                <Segmented label="合并方式" value={methods.includes(method) ? method : methods[0]!} options={methods.map((m) => ({ value: m, label: METHOD_LABEL[m] }))} onChange={setMethod} />
                {methods.length < 3 && <p className={styles.note}>仓库只允许{methods.length === 1 ? '这一种' : `这 ${methods.length} 种`}</p>}
              </div>
            </div>
            <div className={styles.field}>
              <span className={styles.label} />
              <div className={styles.control}>
                <Checkbox
                  checked={details.repo.deleteBranchOnMerge || (deleteRemote && !view.waitForChecks)}
                  disabled={details.repo.deleteBranchOnMerge || view.waitForChecks || busy}
                  onChange={setDeleteRemote}
                  label="合并后删除远程分支（本地分支保留）"
                  note={details.repo.deleteBranchOnMerge ? '仓库设置了合并后自动删除' : view.waitForChecks ? '检查通过后合并时由仓库设置决定' : null}
                />
                <Checkbox checked={archive} disabled={target.isMain || busy} onChange={setArchiveAfter} label="合并后归档 worktree" note={null} />
              </div>
            </div>
          </div>
        )}

        {failure && (
          <p className={styles.failure} role="alert">
            <CircleX {...ICON} />
            {failure}
          </p>
        )}

        <footer className={styles.footer}>
          {phase.kind !== 'done' && <span className={styles.footerNote}>{blocked ? view.blockers[0] : who}</span>}
          <span className={styles.spacer} />
          {phase.kind !== 'done' && (
            <button type="button" className={styles.cancel} disabled={busy} onClick={() => closeMergeSheet(true)}>
              取消
            </button>
          )}
          {phase.kind === 'done' ? (
            <button type="button" className={styles.primary} onClick={() => closeMergeSheet(true)}>
              完成
              <span className={styles.shortcut}>⌘↵</span>
            </button>
          ) : (
            <button type="button" className={styles.primary} disabled={blocked || busy} onClick={() => void merge()}>
              {busy ? '正在合并…' : view.waitForChecks ? '检查通过后合并' : `合并 PR #${pr.number}`}
              <span className={styles.shortcut}>⌘↵</span>
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
