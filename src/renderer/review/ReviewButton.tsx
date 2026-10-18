// 让 agent 审阅 (PRD F13): a ghost button in Git · 变更 and on 待审阅 overview rows. Disabled with the reason as its
// tooltip while the agent cannot take the command; the review itself shows up in the session's terminal.
import { useEffect, useState } from 'react'
import type { SessionId } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { requestReview, reviewBlocker, reviewCommand } from './review'

const FAILURE_SHOWN_MS = 4000

export function ReviewButton({ sessionId, className }: { sessionId: SessionId; className?: string }) {
  const session = useWorkspace((s) => s.sessions.find((x) => x.id === sessionId))
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (!failure) return
    const timer = window.setTimeout(() => setFailure(null), FAILURE_SHOWN_MS)
    return () => window.clearTimeout(timer)
  }, [failure])

  if (!session || reviewCommand(session.kind) === null) return null
  const blocker = reviewBlocker(session)
  const command = reviewCommand(session.kind)

  return (
    <button
      type="button"
      className={className}
      disabled={blocker !== null || busy}
      title={failure ?? blocker ?? `在终端里发送 ${command}`}
      onClick={(event) => {
        event.stopPropagation()
        setBusy(true)
        setFailure(null)
        requestReview(sessionId)
          .catch((error: unknown) => setFailure(`没能发送：${error instanceof Error ? error.message : String(error)}`))
          .finally(() => setBusy(false))
      }}
    >
      {failure ? '没能发送' : busy ? '正在发送…' : '让 agent 审阅'}
    </button>
  )
}
