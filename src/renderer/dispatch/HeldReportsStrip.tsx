// Under a session's terminal (PRD F21): dispatch messages Wavi could not put in without typing — reports from the
// sessions it started, what became of its `wavi run`, or its dispatcher's `wavi send` (its agent has no channel,
// someone may be typing there, delivery failed, or it was woken 20 times this hour). 送进去 types them as a message,
// which the user chose to send; a dialog on its screen refuses that like any send (§6.9).
import { useState } from 'react'
import { Inbox } from 'lucide-react'
import { useActiveSession } from '../state/workspace'
import { sendHeld } from './reports'
import { useDispatch } from './store'
import styles from '../scripts/SetupStrip.module.css'

export function HeldReportsStrip() {
  const active = useActiveSession()
  const id = active?.session.id ?? null
  const held = useDispatch((s) => (id ? s.held[id] : undefined))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!id || !held || held.length === 0) return null
  const names = held.map((i) => `「${i.kind === 'report' ? i.report.title : i.title}」`).join('、')
  const label = held.every((i) => i.kind === 'report') ? `${held.length} 份派活报告还没送进去：${names}` : `${held.length} 条派活消息还没送进去：${names}`
  return (
    <div className={styles.bar} role="status" data-testid="held-reports">
      <span className={styles.icon}>
        <Inbox size={16} strokeWidth={1.75} />
      </span>
      <p className={styles.title} title={error ?? label}>
        {error ?? label}
      </p>
      <button
        type="button"
        className={styles.primary}
        disabled={busy}
        title="作为一条消息发给这个会话里的 agent"
        onClick={() => {
          setBusy(true)
          void sendHeld(id).then((problem) => {
            setBusy(false)
            setError(problem)
          })
        }}
      >
        送进去
      </button>
    </div>
  )
}
