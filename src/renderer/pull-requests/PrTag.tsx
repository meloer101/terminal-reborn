// `#123 ✓` (PRD F16): a PR's number, its state when it is not simply open, and a mark for its checks. Mono and
// tertiary like the other row metadata; color only on the checks mark, whose shape (✓ ✗ ◌) carries the meaning too,
// and the full description is the tag's accessible name and tooltip. While the PR poll fails (合入链路 v2, Figma 73I)
// the tag reads `#12 ? 查询失败` instead of a state that may be stale.
import { memo } from 'react'
import { Check, CircleDashed, CircleHelp, X } from 'lucide-react'
import { prDescription, prStateLabel, type ChecksState, type PullRequestInfo } from '@shared/pull-requests'
import { PR_QUERY_FAILED, useSessionPrStatus } from './store'
import styles from './PrTag.module.css'

const MARK_ICON = { size: 12, strokeWidth: 2, 'aria-hidden': true } as const

export function ChecksMark({ state }: { state: ChecksState }) {
  if (state === 'none') return null
  return (
    <span className={styles.mark} data-checks={state}>
      {state === 'passing' ? <Check {...MARK_ICON} /> : state === 'failing' ? <X {...MARK_ICON} /> : <CircleDashed {...MARK_ICON} />}
    </span>
  )
}

export function PrTag({ pr, error }: { pr: PullRequestInfo; error?: string | null }) {
  const live = pr.state === 'open' || pr.state === 'draft'
  const description = prDescription(pr)
  if (error) {
    const said = `PR #${pr.number} · ${PR_QUERY_FAILED}：${error}`
    return (
      <span className={styles.tag} role="img" aria-label={said} title={said} data-testid="pr-tag" data-pr-state={pr.state} data-error="">
        <span className={styles.number}>#{pr.number}</span>
        <span className={styles.mark} data-checks="unknown">
          <CircleHelp {...MARK_ICON} />
        </span>
        <span className={styles.state}>{PR_QUERY_FAILED}</span>
      </span>
    )
  }
  return (
    <span
      className={styles.tag}
      role="img"
      aria-label={description}
      title={description}
      data-testid="pr-tag"
      data-pr-state={pr.state}
      data-checks={live ? pr.checks.state : undefined}
    >
      <span className={styles.number}>#{pr.number}</span>
      {pr.state !== 'open' && <span className={styles.state}>{prStateLabel(pr.state)}</span>}
      {live && <ChecksMark state={pr.checks.state} />}
    </span>
  )
}

/** The PR of a session's worktree, or nothing (no PR known, or gh not ready). */
export const SessionPrTag = memo(function SessionPrTag({ sessionId }: { sessionId: string }) {
  const status = useSessionPrStatus(sessionId)
  return status?.pr ? <PrTag pr={status.pr} error={status.error?.message ?? null} /> : null
})
