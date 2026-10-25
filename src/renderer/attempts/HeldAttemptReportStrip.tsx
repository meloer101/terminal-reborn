// Under the terminal of a session whose 同任务多解 report could not go through its agent's own channel (Figma 26J):
// 送进去 types it as a message, which the user chose to send; a dialog on its screen refuses that like any send (§6.9).
import { useState } from 'react'
import { useActiveSession } from '../state/workspace'
import { PromptStrip } from './PromptStrip'
import { sendHeldAttemptReport, useAttemptReports } from './report'

export function HeldAttemptReportStrip() {
  const active = useActiveSession()
  const id = active?.session.id ?? null
  const held = useAttemptReports((s) => (id ? s.held[id] : undefined))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!id || !held) return null
  const send = (): void => {
    setBusy(true)
    void sendHeldAttemptReport(id).then((problem) => {
      setBusy(false)
      setError(problem)
    })
  }
  return (
    <PromptStrip
      testId="held-attempt-report"
      question={error ?? `同任务多解的 ${held.count} 份都做完了`}
      detail={held.summary}
      actions={[{ label: '送进去', disabled: busy, onClick: send }]}
    />
  )
}
