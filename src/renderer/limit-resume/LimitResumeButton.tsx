// 恢复后发送“继续” (PRD F11): next to the used-up UsageChip in the session header, and in the overview row's summary.
// A toggle: the first click asks Wavi to type 继续 once the limit resets, then it shows when; the next click calls it off.
// Figma 待补: drawn like the header's /compact companion button (SessionMeta.module.css), no new token.
import { armedLabel, RESUME_BUTTON, RESUME_PROMPT, resumeDueAt, resumeHint, stopNote } from '@shared/limit-resume'
import { formatClock } from '@shared/session-meta'
import type { SessionId } from '@shared/types'
import { useMetaNow } from '../session-meta/MetaChips'
import { timing, toggleLimitResume } from './bridge'
import { useLimitResume, useLimitStop } from './store'
import styles from './LimitResume.module.css'

/** A click leaves the keyboard in the terminal (the agent keeps its input); Tab still reaches the button. */
const keepFocus = (event: { preventDefault(): void }) => event.preventDefault()

function useResumeView(sessionId: SessionId) {
  const stop = useLimitStop(sessionId)
  const plan = useLimitResume((s) => s.plans[sessionId])
  const now = useMetaNow()
  return { stop, plan, now }
}

/** Whether the session has the toggle (stopped by its plan limit, or a send already asked for). */
export function useLimitResumeShown(sessionId: SessionId): boolean {
  const { stop, plan } = useResumeView(sessionId)
  return stop !== null || plan !== undefined
}

/** The toggle; nothing unless the session is stopped by its plan limit or a send is already asked for. */
export function LimitResumeButton({ sessionId }: { sessionId: SessionId }) {
  const { stop, plan, now } = useResumeView(sessionId)
  if (!stop && !plan) return null
  const title = plan
    ? `约 ${formatClock(resumeDueAt(plan, timing()), now)} 在终端里输入“${RESUME_PROMPT}”并回车 · 再点一次取消`
    : stop
      ? resumeHint(stop, now, timing())
      : ''
  return (
    <button
      type="button"
      className={styles.toggle}
      data-testid="limit-resume"
      data-armed={plan !== undefined}
      aria-pressed={plan !== undefined}
      title={title}
      onMouseDown={keepFocus}
      onClick={(event) => {
        event.stopPropagation()
        toggleLimitResume(sessionId, stop)
      }}
    >
      {plan ? armedLabel(plan, now, timing()) : RESUME_BUTTON}
    </button>
  )
}

/** The overview row's summary while the limit holds the session: when it resets, and the same toggle. */
export function LimitResumeSummary({ sessionId, fallback }: { sessionId: SessionId; fallback: string }) {
  const { stop, plan, now } = useResumeView(sessionId)
  if (!stop && !plan) return <>{fallback}</>
  return (
    <span className={styles.summary} data-testid="limit-resume-summary">
      {stop && <span className={styles.note}>{stopNote(stop, now)}</span>}
      <LimitResumeButton sessionId={sessionId} />
    </span>
  )
}
