// The review result at the top of Git · 变更 (PRD F13 v1.78, Figma 29B2 / 29K2): who reviewed how many files, the
// reviewer's conclusion (two lines at most), the findings one per line (tick to send, click to jump), 重审 and 发给 <agent>.
import { Check } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ReviewComment } from '@shared/review-comments'
import type { SessionId } from '@shared/types'
import { StatusGlyph } from '../ui/StatusGlyph'
import { setCommentPicked, useReviewComments } from '../state/review-comments'
import { useWorkspace } from '../state/workspace'
import { cancelBackgroundReview, loadSavedReview, startBackgroundReview, useBackgroundReview } from './background'
import { revealInDiff, useReviewFlash } from './reveal'
import { reviewBlockView, sendLabel, type FindingRow } from './review-block-model'
import { sendFindings } from './send'
import styles from './ReviewBlock.module.css'

const FAILURE_SHOWN_MS = 4000
/** The block reads these rows' comments; one stable empty list keeps the memo from running on every store change. */
const NO_COMMENTS: readonly ReviewComment[] = []

/** Whether the block shows anything for this worktree (running, failed or a result): then it owns 重审 / 取消. */
export function useReviewShown(root: string): boolean {
  const status = useBackgroundReview((s) => s.byRoot[root])
  const comments = useReviewComments((s) => s.byRoot[root]) ?? NO_COMMENTS
  const findings = useMemo(() => comments.filter((c) => c.origin === 'review'), [comments])
  return useMemo(() => reviewBlockView(status, findings) !== null, [status, findings])
}

export function ReviewBlock({ sessionId, root }: { sessionId: SessionId; root: string }) {
  const session = useWorkspace((s) => s.sessions.find((x) => x.id === sessionId))
  const baseBranch = useWorkspace((s) => s.worktrees.find((w) => w.path === root)?.baseBranch)
  const status = useBackgroundReview((s) => s.byRoot[root])
  const comments = useReviewComments((s) => s.byRoot[root]) ?? NO_COMMENTS
  const flashing = useReviewFlash((s) => s.finding)
  const [busy, setBusy] = useState<'review' | 'send' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => loadSavedReview(root), [root])
  useEffect(() => {
    if (!failure) return
    const timer = window.setTimeout(() => setFailure(null), FAILURE_SHOWN_MS)
    return () => window.clearTimeout(timer)
  }, [failure])

  const findings = useMemo(() => comments.filter((c) => c.origin === 'review'), [comments])
  const view = useMemo(() => reviewBlockView(status, findings), [status, findings])
  if (!view) return null

  const agent = session?.kind === 'claude' || session?.kind === 'codex' ? session.kind : null
  const reviewAgain = (): void => {
    if (!agent) return
    setBusy('review')
    setFailure(null)
    startBackgroundReview(root, agent, 'manual', baseBranch, true)
      .catch((error: unknown) => setFailure(`没能开始：${error instanceof Error ? error.message : String(error)}`))
      .finally(() => setBusy(null))
  }

  if (view.kind === 'running') {
    return (
      <section className={styles.block} aria-label="审阅" data-testid="review-block">
        <div className={styles.head}>
          <span className={styles.running} role="status">
            <StatusGlyph status="running" />
            {view.text}
          </span>
          <span className={styles.spacer} />
          <button type="button" className={styles.action} onClick={() => cancelBackgroundReview(root)}>
            取消
          </button>
        </div>
      </section>
    )
  }

  if (view.kind === 'failed') {
    return (
      <section className={styles.block} aria-label="审阅" data-testid="review-block">
        <div className={styles.head}>
          <span className={styles.failed} role="status" title={view.text}>
            {failure ?? view.text}
          </span>
          <span className={styles.spacer} />
          <button type="button" className={styles.action} disabled={!agent || busy !== null} onClick={reviewAgain}>
            重审
          </button>
        </div>
      </section>
    )
  }

  const send = (): void => {
    if (!session || !agent) return
    setBusy('send')
    setFailure(null)
    sendFindings(root, session)
      .catch((error: unknown) => setFailure(`没能发送：${error instanceof Error ? error.message : String(error)}`))
      .finally(() => setBusy(null))
  }
  const jump = (row: FindingRow): void => {
    const comment = findings.find((c) => c.id === row.id)
    if (comment) void revealInDiff(root, comment)
  }

  return (
    <section className={styles.block} aria-label="审阅" data-testid="review-block">
      <div className={styles.head}>
        <span className={styles.title}>{view.header}</span>
        <span className={styles.spacer} />
        <span className={styles.counts}>{view.counts}</span>
      </div>
      {view.summary && (
        <p className={styles.summary} title={view.summary}>
          {view.summary}
        </p>
      )}
      {view.rows.length > 0 && (
        <ul className={styles.list} aria-label="审阅发现">
          {view.rows.map((row) => (
            <li key={row.id} className={styles.finding} data-finding-id={row.id} data-flash={flashing === row.id || undefined}>
              <button
                type="button"
                role="checkbox"
                aria-checked={row.picked}
                aria-label={row.picked ? '发送时包含这条' : '发送时不包含这条'}
                title={row.picked ? '发送时包含这条' : '勾选后发给 agent'}
                className={styles.pick}
                onClick={() => setCommentPicked(root, row.id, !row.picked)}
              >
                {row.picked && <Check size={10} strokeWidth={2.5} aria-hidden />}
              </button>
              <button type="button" className={styles.findingMain} title={row.locationTitle} onClick={() => jump(row)}>
                {row.severity && (
                  <span className={styles.severity} data-tone={row.tone}>
                    {row.severity}
                  </span>
                )}
                <span className={styles.location}>{row.location}</span>
                <span className={styles.findingTitle}>{row.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        {failure && <span className={styles.failed}>{failure}</span>}
        <span className={styles.spacer} />
        <button type="button" className={styles.action} disabled={!agent || busy !== null} onClick={reviewAgain}>
          重审
        </button>
        {agent && (
          <button type="button" className={styles.action} disabled={view.picked === 0 || busy !== null} onClick={send}>
            {sendLabel(agent, view.picked)}
          </button>
        )}
      </div>
    </section>
  )
}
