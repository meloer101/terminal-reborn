// Under a dispatcher's terminal (PRD F21): reports from its sessions that Wavi could not put in without typing (its
// agent has no channel, delivery failed, or it was woken 20 times this hour). 送进去 types them as a message, which
// the user chose to send; a dialog on its screen refuses that like any send (§6.9).
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
  const names = held.map((r) => `「${r.title}」`).join('、')
  return (
    <div className={styles.bar} role="status" data-testid="held-reports">
      <span className={styles.icon}>
        <Inbox size={16} strokeWidth={1.75} />
      </span>
      <p className={styles.title} title={error ?? `${names}的结果还没交给这个会话里的 agent`}>
        {error ?? `${held.length} 份派活报告还没送进去：${names}`}
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
