import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useBlockingDialog } from '../session-io'
import { useActiveSession, useWorkspace } from '../state/workspace'
import { StatusGlyph } from '../ui/StatusGlyph'
import { focusComposer, focusTerminal, restartAgent } from './actions'
import { useHostRestart } from './host-restart'
import { useLaunchIssues } from './launch-issues'
import { cardModel, type CardAction } from './model'
import styles from './LifecycleCard.module.css'

/** Whether moving the keyboard focus now would take it from something the user is typing in. */
function canStealFocus(): boolean {
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return false
  const active = document.activeElement
  if (!active || active === document.body) return true
  const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active as HTMLElement).isContentEditable
  return !typing || active.matches('textarea[aria-label="输入框"], .xterm-helper-textarea')
}

/**
 * B7: after a session is created or opened the keyboard belongs to the right place: the terminal while the agent
 * is starting or blocked (a dialog there waits for keys), the composer once it is ready, the card's own button
 * when a card replaces the composer.
 */
function useSessionFocus(sessionId: string | null, phase: string | undefined, kind: string | undefined, primary: React.RefObject<HTMLButtonElement | null>): void {
  useEffect(() => {
    if (!sessionId) return
    let frame = 0
    let tries = 0
    const attempt = (): void => {
      if (!canStealFocus()) return
      let done = false
      // No phase: a plain shell (or a stand-in for one), whose terminal is where the user types.
      if (phase === undefined || phase === 'starting' || phase === 'blocked' || kind === 'shell') done = focusTerminal(sessionId)
      else if (phase === 'not-started' || phase === 'exited') {
        if (primary.current) {
          primary.current.focus()
          done = true
        }
      } else done = focusComposer()
      // The terminal and the composer appear a moment after the session does.
      if (!done && tries++ < 90) frame = requestAnimationFrame(attempt)
    }
    attempt()
    return () => cancelAnimationFrame(frame)
  }, [sessionId, phase, kind, primary])
}

/**
 * Figma Screen 10 B: the card that takes the composer's place while the agent cannot take input — a restored
 * session that was not started yet, a first-run dialog or shell prompt in the way, or an agent that exited.
 */
export function LifecycleCard() {
  const active = useActiveSession()
  const session = active?.session ?? null
  const issue = useLaunchIssues((s) => (session ? s.issues[session.id] : undefined))
  const lost = useHostRestart((s) => s.lost)
  const dialog = useBlockingDialog(session?.phase === 'blocked' ? session.id : null)
  const sessionIds = useWorkspace(useShallow((s) => s.sessions.map((x) => x.id)))
  const [busy, setBusy] = useState(false)
  const primaryRef = useRef<HTMLButtonElement>(null)

  const model = session ? cardModel({ session, issue, dialog }) : null
  useSessionFocus(session?.id ?? null, session?.phase, session?.kind, primaryRef)

  // The engine-restarted card (a pty-host crash) already speaks for sessions it took down.
  if (!session || !model || (lost.includes(session.id) && sessionIds.includes(session.id))) return null

  const run = (action: CardAction): void => {
    if (action.id === 'focus') {
      focusTerminal(session.id)
      return
    }
    setBusy(true)
    void restartAgent(session.id, { resume: action.id === 'resume' }).finally(() => setBusy(false))
  }

  return (
    <div className={styles.card} role="status" data-testid="lifecycle-card" data-kind={model.kind} data-session-id={session.id}>
      <span className={styles.glyph}>
        <StatusGlyph status={model.glyph} />
      </span>
      <div className={styles.text}>
        <p className={styles.title}>{model.title}</p>
        <p className={styles.detail}>{model.detail}</p>
      </div>
      <div className={styles.actions}>
        {model.actions.map((action) => (
          <button
            key={action.id}
            ref={action.primary ? primaryRef : undefined}
            type="button"
            className={styles.button}
            data-primary={action.primary ?? false}
            data-action={action.id}
            disabled={busy && action.id !== 'focus'}
            onClick={() => run(action)}
          >
            {action.label}
            {action.primary && <span className={styles.shortcut}>↵</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
