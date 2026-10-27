// The Ship block (PRD F16 v1.78, Figma 29C / 29D / 29H): the exit's title line, its steps with a glyph column
// (◌ working · ✓ done · ○ pending · ✗ failed), and — once the agent has written the text — a last look at it in
// editable fields. It takes the place of the facts and the footer in Git · 变更. ⌘↵ goes ahead, Esc cancels.
import { Check } from 'lucide-react'
import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { cancelShip, editShip, handConflictsToAgent, retryShip, submitShip, switchToPr, useShips } from './ship-runner'
import { glanceFields, STEP_GLYPH_NAME, stepGlyph, submitBlocker, submitLabel, type ShipState } from './ship-flow'
import { StatusGlyph } from '../ui/StatusGlyph'
import styles from './ShipBlock.module.css'

export function ShipBlock({ worktree, base, hasSession }: { worktree: string; base: string; hasSession: boolean }) {
  const state = useShips((s) => s.byWorktree[worktree])
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  // The block takes the keyboard, so ⌘↵ and Esc work without a click.
  useEffect(() => ref.current?.focus(), [])
  if (!state) return null

  const failedInRun = state.error !== null && state.failedIn === 'running'
  // After a failed run the text stays editable: a commit hook may want a different message.
  const showFields = state.stage === 'glance' || failedInRun
  const blocker = showFields ? submitBlocker(state) : null
  const running = state.stage === 'running' && state.error === null
  const goAhead = (): void => {
    if (state.error) {
      if (!blocker) retryShip(worktree)
    } else if (state.stage === 'glance' && !blocker) submitShip(worktree)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.nativeEvent.isComposing || event.defaultPrevented) return
    if (event.key === 'Escape' && !running) {
      event.preventDefault()
      cancelShip(worktree)
    } else if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault()
      goAhead()
    }
  }

  return (
    <div
      ref={ref}
      className={styles.ship}
      role="group"
      aria-labelledby={titleId}
      aria-busy={running}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-testid="ship-block"
      data-stage={state.stage}
    >
      <div className={styles.body}>
        <p id={titleId} className={styles.title}>
          {state.title}
        </p>
        <ol className={styles.steps}>
          {state.steps.map((step) => (
            <li key={step.id} className={styles.step} data-state={step.state} data-step={step.id}>
              {step.state === 'working' ? (
                // ◌ is all but invisible in the UI font; the session spinner is the app's one "in progress" sign.
                <span className={styles.glyph}>
                  <StatusGlyph status="running" />
                </span>
              ) : (
                <span className={styles.glyph} role="img" aria-label={STEP_GLYPH_NAME[step.state]}>
                  {stepGlyph(step.state)}
                </span>
              )}
              <span className={styles.stepBody}>
                <span className={styles.stepText}>
                  {step.label}
                  {step.note && <span className={styles.stepNote}> · {step.note}</span>}
                </span>
                {state.error?.step === step.id && <StepFailure state={state} worktree={worktree} hasSession={hasSession} />}
              </span>
            </li>
          ))}
        </ol>
        {showFields && <Fields state={state} worktree={worktree} base={base} />}
      </div>
      <div className={styles.footer}>
        <button type="button" className={styles.ghost} disabled={running} onClick={() => cancelShip(worktree)}>
          取消
        </button>
        <span className={styles.spacer} />
        {state.error ? (
          <button type="button" className={styles.primary} disabled={blocker !== null} title={blocker ?? undefined} onClick={goAhead}>
            重试
            {showFields && <span className={styles.shortcut}>⌘↵</span>}
          </button>
        ) : (
          state.stage === 'glance' && (
            <button type="button" className={styles.primary} disabled={blocker !== null} title={blocker ?? undefined} onClick={goAhead}>
              {submitLabel(state.kind)}
              <span className={styles.shortcut}>⌘↵</span>
            </button>
          )
        )}
      </div>
    </div>
  )
}

/** Under the failed step: what went wrong, what git printed, and the way out that fits. */
function StepFailure({ state, worktree, hasSession }: { state: ShipState; worktree: string; hasSession: boolean }) {
  const error = state.error!
  return (
    <span className={styles.failure} role="alert">
      <span className={styles.failureText}>{error.message}</span>
      {error.output && <pre className={styles.output}>{error.output}</pre>}
      {((error.conflicts && hasSession) || error.pushRefused) && (
        <span className={styles.failureActions}>
          {error.conflicts && hasSession && (
            <button type="button" className={styles.ghost} onClick={() => void handConflictsToAgent(worktree)}>
              交给 {state.agent} 解
            </button>
          )}
          {error.pushRefused && (
            <button type="button" className={styles.ghost} onClick={() => switchToPr(worktree)}>
              改为创建 PR
            </button>
          )}
        </span>
      )}
    </span>
  )
}

function Fields({ state, worktree, base }: { state: ShipState; worktree: string; base: string }) {
  const { texts } = state
  return (
    <div className={styles.fields}>
      {glanceFields(state).map((field) => {
        switch (field) {
          case 'commit':
            return (
              <label key={field} className={styles.field}>
                <span className={styles.label}>提交说明</span>
                <textarea
                  className={styles.mono}
                  data-size="message"
                  value={texts.commit}
                  spellCheck={false}
                  onChange={(e) => editShip(worktree, { commit: e.currentTarget.value })}
                />
              </label>
            )
          case 'title':
            return (
              <label key={field} className={styles.field}>
                <span className={styles.label}>标题</span>
                <input className={styles.input} value={texts.title} spellCheck={false} onChange={(e) => editShip(worktree, { title: e.currentTarget.value })} />
              </label>
            )
          case 'body':
            return (
              <label key={field} className={styles.field}>
                <span className={styles.label}>正文</span>
                <textarea
                  className={styles.mono}
                  data-size="body"
                  value={texts.body}
                  spellCheck={false}
                  onChange={(e) => editShip(worktree, { body: e.currentTarget.value })}
                />
              </label>
            )
          case 'base':
            return (
              <div key={field} className={styles.optionRow}>
                <span className={styles.option}>合到 {base}</span>
                <span className={styles.spacer} />
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={texts.draft}
                  className={styles.checkbox}
                  onClick={() => editShip(worktree, { draft: !texts.draft })}
                >
                  <span className={styles.box} aria-hidden>
                    {texts.draft && <Check size={12} strokeWidth={2.5} />}
                  </span>
                  草稿
                </button>
              </div>
            )
          case 'draft':
            return null
        }
      })}
    </div>
  )
}
