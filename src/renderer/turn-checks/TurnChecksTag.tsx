// `测试 ✓ · lint ✗ · 类型 未跑` (PRD F9 “这一轮跑过哪些检查”): what the agent ran since the user's last prompt, from its
// hooks (no tokens). Row metadata, so caption-size and quiet; color only on the marks, whose shapes (✓ ✗ ?) carry the
// meaning too, and the full description with every command is the tag's accessible name and tooltip.
import { memo } from 'react'
import { Check, CircleHelp, X } from 'lucide-react'
import { checksDescription, KIND_LABEL, runNote, turnCheckView, type CheckOutcome, type CheckRun, type TurnCheckView } from '@shared/turn-checks'
import type { SessionId } from '@shared/types'
import { useSessionMeta } from '../session-meta/store'
import styles from './TurnChecks.module.css'

const MARK_ICON = { size: 12, strokeWidth: 2, 'aria-hidden': true } as const

export function CheckMark({ outcome }: { outcome: CheckOutcome }) {
  return (
    <span className={styles.mark} data-outcome={outcome}>
      {outcome === 'pass' ? <Check {...MARK_ICON} /> : outcome === 'fail' ? <X {...MARK_ICON} /> : <CircleHelp {...MARK_ICON} />}
    </span>
  )
}

const RUN_MARK: Record<CheckOutcome, string> = { pass: '✓', fail: '✗', unknown: '?' }

/** One line per run for a tooltip: `✗ npm run lint`, `? npm test | tail（看不出结果）`. */
export function runLine(run: CheckRun): string {
  const note = runNote(run)
  return `${RUN_MARK[run.outcome]} ${run.command}${note ? `（${note}）` : ''}`
}

/** The session's turn checks as a view, or null when there is nothing to say. */
export function useTurnCheckView(sessionId: SessionId | undefined): TurnCheckView | null {
  const checks = useSessionMeta((m) => (sessionId ? m.bySession[sessionId]?.checks : undefined))
  return turnCheckView(checks)
}

export function TurnChecksBody({ view }: { view: TurnCheckView }) {
  const description = checksDescription(view)
  const tooltip = [description, ...view.runs.map(runLine)].join('\n')
  return (
    <span className={styles.tag} role="img" aria-label={description} title={tooltip} data-testid="turn-checks" data-turn={view.turn}>
      {view.turn === 'previous' && <span className={styles.when}>上一轮</span>}
      {view.kinds.length === 0 ? (
        <span className={styles.none}>没跑检查</span>
      ) : (
        view.kinds.map((k, i) => (
          <span key={k.kind} className={styles.item} data-kind={k.kind} data-status={k.status}>
            {i > 0 && (
              <span className={styles.sep} aria-hidden>
                ·
              </span>
            )}
            <span className={styles.label}>{KIND_LABEL[k.kind]}</span>
            {k.status === 'not-run' ? <span className={styles.notRun}>未跑</span> : <CheckMark outcome={k.status} />}
          </span>
        ))
      )}
    </span>
  )
}

/** The tag for a session, or nothing (it neither edited nor checked, this turn or the last one that did). */
export const TurnChecksTag = memo(function TurnChecksTag({ sessionId }: { sessionId: SessionId }) {
  const view = useTurnCheckView(sessionId)
  return view ? <TurnChecksBody view={view} /> : null
})
