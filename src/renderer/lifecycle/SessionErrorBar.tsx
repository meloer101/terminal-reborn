import { useState } from 'react'
import type { SessionId } from '@shared/types'
import { submitPrompt } from '../session-io'
import { startSession } from '../state/session-start'
import { useActiveSession, useWorkspace } from '../state/workspace'
import { StatusGlyph } from '../ui/StatusGlyph'
import { ensureAgentUp } from './agent-up'
import { CONTINUE_PROMPT, errorNextSteps, fixPrompt, type RetryKind } from './error-next-steps'
import { useLaunchIssues } from './launch-issues'
import styles from './SessionErrorBar.module.css'

async function askToFix(sessionId: SessionId, summary: string): Promise<void> {
  await ensureAgentUp(sessionId)
  await submitPrompt(sessionId, fixPrompt(summary))
}

async function retry(sessionId: SessionId, kind: RetryKind): Promise<void> {
  if (kind === 'continue') await submitPrompt(sessionId, CONTINUE_PROMPT)
  else await startSession(sessionId, { resume: true })
}

/**
 * An errored session says what went wrong and what to do next, under its terminal (phase 2b): the error in one
 * line, "让 agent 修复" (resume if needed, then hand it the error) and 重试.
 */
export function SessionErrorBar() {
  const active = useActiveSession()
  const id = active?.session.id ?? null
  const issue = useLaunchIssues((s) => (id ? s.issues[id] : undefined))
  if (!active) return null
  const steps = errorNextSteps(active.session, issue)
  if (!steps) return null
  return <Bar key={id} sessionId={active.session.id} summary={steps.summary} canFix={steps.canFix} retryKind={steps.retry} />
}

function Bar({ sessionId, summary, canFix, retryKind }: { sessionId: SessionId; summary: string; canFix: boolean; retryKind: RetryKind | null }) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const run = (action: () => Promise<void>): void => {
    setBusy(true)
    setFailure(null)
    useWorkspace.getState().requestTerminalFocus()
    action()
      .catch((error: unknown) => setFailure(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false))
  }

  return (
    <div className={styles.bar} role="status" data-testid="session-error">
      <span className={styles.glyph}>
        <StatusGlyph status="error" />
      </span>
      <div className={styles.text}>
        <p className={styles.title}>{summary}</p>
        {failure && <p className={styles.detail}>没能完成：{failure}</p>}
      </div>
      {retryKind && (
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => run(() => retry(sessionId, retryKind))}>
          {retryKind === 'continue' ? '重试这一轮' : '重新启动'}
        </button>
      )}
      {canFix && (
        <button type="button" className={styles.primary} disabled={busy} onClick={() => run(() => askToFix(sessionId, summary))}>
          让 agent 修复
        </button>
      )}
    </div>
  )
}
