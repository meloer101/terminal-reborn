// 让 agent 审阅 (PRD F13): a ghost button in Git · 变更 and on 待审阅 overview rows. With Wavi's built-in reviewer
// (the default) it starts a read-only background review of all the worktree's changes, shown in the review block at
// the top of Git · 变更 (label 审阅全部改动), and turns into 取消审阅 while it runs. With 审阅方式 · agent 自带命令 it types the agent's own review command into the session,
// disabled with the reason as its tooltip while the agent cannot take it.
import { useEffect, useState } from 'react'
import type { SessionId } from '@shared/types'
import { agentLabel } from '../panels/merge/model'
import { useSettings } from '../settings/useSettings'
import { useWorkspace } from '../state/workspace'
import { cancelBackgroundReview, startBackgroundReview, useBackgroundReview } from './background'
import { requestReview, reviewBlocker, reviewCommand } from './review'

const FAILURE_SHOWN_MS = 4000

export function ReviewButton({ sessionId, className }: { sessionId: SessionId; className?: string }) {
  const session = useWorkspace((s) => s.sessions.find((x) => x.id === sessionId))
  const worktree = useWorkspace((s) => (session ? s.worktrees.find((w) => w.id === session.worktreeId) : undefined))
  const { settings, loaded } = useSettings()
  const status = useBackgroundReview((s) => (worktree ? s.byRoot[worktree.path] : undefined))
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (!failure) return
    const timer = window.setTimeout(() => setFailure(null), FAILURE_SHOWN_MS)
    return () => window.clearTimeout(timer)
  }, [failure])

  if (!session || !worktree || !loaded || (session.kind !== 'claude' && session.kind !== 'codex')) return null
  const agent = session.kind

  if (settings.review.mode === 'agent-command') {
    const blocker = reviewBlocker(session)
    return (
      <button
        type="button"
        className={className}
        disabled={blocker !== null || busy}
        title={failure ?? blocker ?? `在终端里发送 ${reviewCommand(agent)}`}
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

  if (status?.phase === 'running') {
    return (
      <button
        type="button"
        className={className}
        title={status.message}
        onClick={(event) => {
          event.stopPropagation()
          cancelBackgroundReview(worktree.path)
        }}
      >
        取消审阅
      </button>
    )
  }

  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      title={failure ?? `在后台用 ${agentLabel(agent)} 只读审阅全部改动（用你自己的额度），结果显示在变更的顶部`}
      onClick={(event) => {
        event.stopPropagation()
        setBusy(true)
        setFailure(null)
        startBackgroundReview(worktree.path, agent, 'manual', worktree.baseBranch)
          .catch((error: unknown) => setFailure(`没能开始：${error instanceof Error ? error.message : String(error)}`))
          .finally(() => setBusy(false))
      }}
    >
      {failure ? '没能开始' : '审阅全部改动'}
    </button>
  )
}
