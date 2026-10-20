// `#123 ✓` (PRD F16): a PR's number, its state when it is not simply open, and a mark for its checks. Mono and
// tertiary like the other row metadata; color only on the checks mark, whose shape (✓ ✗ ◌) carries the meaning too,
// and the full description is the tag's accessible name and tooltip.
import { memo } from 'react'
import { Check, CircleDashed, X } from 'lucide-react'
import { prDescription, prStateLabel, type ChecksState, type PullRequestInfo } from '@shared/pull-requests'
import { useSessionPr } from './store'
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

export function PrTag({ pr }: { pr: PullRequestInfo }) {
  const live = pr.state === 'open' || pr.state === 'draft'
  const description = prDescription(pr)
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

/** The PR of a session's worktree, or nothing (no PR, or gh not ready). */
export const SessionPrTag = memo(function SessionPrTag({ sessionId }: { sessionId: string }) {
  const pr = useSessionPr(sessionId)
  return pr ? <PrTag pr={pr} /> : null
})
