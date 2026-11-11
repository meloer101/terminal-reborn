// The Ship block (PRD F16 v1.78, Figma 29C / 29D / 29H): the exit's title line, its steps with a glyph column
// (◌ working · ✓ done · ○ pending · ✗ failed), and — once the agent has written the text — a last look at it in
// editable fields. It takes the place of the facts and the footer in Git · 变更. ⌘↵ goes ahead, Esc cancels. A failed
// step says what git said in plain words (合入链路 v2, Figma 73E), and the footer offers the one way on: 同步 / 拉取 /
// 提交… (the chain's own action), 改为创建 PR, 交给 <agent> (into its input line, never sent), 重试, or only 取消.
import { ArrowDown, ArrowUp, Check, CircleAlert, GitCommitHorizontal, GitMerge, GitPullRequest, RefreshCw, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { CHAIN_LABEL, CHAIN_TEXT, type ChainActionId } from '@shared/ship-chain'
import type { ShipKind } from '@shared/ship'
import { runChainCommand } from './chain-actions'
import { agentLabel } from '../panels/merge/model'
import {
  cancelShip,
  editShip,
  handConflictsToAgent,
  hasHandoffText,
  retryShip,
  shipCanRetry,
  shipFinished,
  submitShip,
  switchToPr,
  useShipHandoffSession,
  useShips
} from './ship-runner'
import {
  failureOutput,
  failureWay,
  glanceFields,
  heldBeforeStart,
  STEP_GLYPH_NAME,
  stepGlyph,
  submitBlocker,
  submitLabel,
  titleIcon,
  type FailureWay,
  type ShipState
} from './ship-flow'
import { StatusGlyph } from '../ui/StatusGlyph'
import styles from './ShipBlock.module.css'

const TITLE_ICON: Record<ShipKind | 'push', LucideIcon> = {
  main: GitMerge,
  pr: GitPullRequest,
  'push-pr': GitPullRequest,
  push: ArrowUp,
  commit: GitCommitHorizontal,
  sync: RefreshCw,
  pull: ArrowDown
}

/** The label of a chain action a failure leads to (Figma 73E1: 同步 main). */
function chainLabel(id: ChainActionId, base: string): string {
  switch (id) {
    case 'commit':
      return CHAIN_LABEL.commit
    case 'sync':
      return CHAIN_LABEL.sync(base)
    case 'pull':
      return CHAIN_LABEL.pull
    case 'push':
      return CHAIN_LABEL.push
    case 'pr':
      return CHAIN_LABEL.createPr
    case 'main':
      return CHAIN_LABEL.mergePush(base)
    case 'merge-pr':
      return CHAIN_LABEL.mergePr(null)
    case 'archive':
      return CHAIN_LABEL.archive
  }
}

export function ShipBlock({ worktree, base }: { worktree: string; base: string }) {
  const state = useShips((s) => s.byWorktree[worktree])
  // 交给 <agent> types into the session the run started with: it names and enables the button.
  const handoffSession = useShipHandoffSession(worktree)
  const hasSession = handoffSession !== null
  const handoffAgent = handoffSession ? agentLabel(handoffSession.kind) : null
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  // The block takes the keyboard, so ⌘↵ and Esc work without a click.
  useEffect(() => ref.current?.focus(), [])
  if (!state) return null

  const failedInRun = state.error !== null && state.failedIn === 'running'
  // After a failed run the text stays editable: a commit hook may want a different message.
  const showFields = state.stage === 'glance' || failedInRun
  const blocker = showFields ? submitBlocker(state) : null
  // Every step went through and the block stays to say something (同步 whose base could not catch up): only 关闭.
  const finished = shipFinished(state)
  const running = state.stage === 'running' && state.error === null && !finished
  const way: FailureWay = state.error ? failureWay(state.error) : null
  const handoff = way?.kind === 'handoff' && hasHandoffText(state.error)
  // 重试 / ⌘↵: the failure's way on, or a failed commit whose message is still editable (beside its own way on).
  const canRetry = shipCanRetry(state)
  const goAhead = (): void => {
    if (state.error) {
      if (canRetry && !blocker) retryShip(worktree)
    } else if (state.stage === 'glance' && !blocker) submitShip(worktree)
  }
  const follow = (id: ChainActionId): void => {
    cancelShip(worktree)
    void runChainCommand(worktree, id)
  }
  const Icon = TITLE_ICON[titleIcon(state)]
  // 同步's pre-check found conflicts: nothing was started, so the step is held (ⓘ, the reason in its place), not failed.
  const held = heldBeforeStart(state)
  const fields = showFields ? glanceFields(state) : []

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
          <span className={styles.titleIcon} aria-hidden>
            <Icon size={16} strokeWidth={1.75} />
          </span>
          {state.title}
        </p>
        <ol className={styles.steps}>
          {state.steps.map((step) =>
            step.id === held?.step ? (
              <li key={step.id} className={styles.step} data-state="held" data-step={step.id}>
                <span className={styles.glyph} role="img" aria-label="没有开始">
                  <CircleAlert size={16} strokeWidth={1.75} aria-hidden />
                </span>
                <span className={styles.stepBody} role="alert">
                  <span className={styles.stepText}>{held.text}</span>
                  {/* A hand-off that could not be typed says why under it. */}
                  {state.error!.message !== held.text && <span className={styles.failureText}>{state.error!.message}</span>}
                </span>
              </li>
            ) : (
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
                  {state.error?.step === step.id && <StepFailure state={state} />}
                </span>
              </li>
            )
          )}
        </ol>
        {fields.length > 0 && <Fields state={state} worktree={worktree} base={base} />}
      </div>
      <div className={styles.footer}>
        <button type="button" className={styles.ghost} disabled={running} onClick={() => cancelShip(worktree)}>
          {finished ? '关闭' : '取消'}
        </button>
        <span className={styles.spacer} />
        {state.error ? (
          <>
            {/* A failed commit's own way on sits beside 重试, which is then the primary (⌘↵). */}
            {way?.kind === 'create-pr' ? (
              <button type="button" className={canRetry ? styles.ghost : styles.primary} onClick={() => switchToPr(worktree)}>
                改为创建 PR
              </button>
            ) : way?.kind === 'chain' ? (
              <button type="button" className={canRetry ? styles.ghost : styles.primary} data-way={way.id} onClick={() => follow(way.id)}>
                {chainLabel(way.id, base)}
              </button>
            ) : handoff ? (
              <button
                type="button"
                className={canRetry ? styles.ghost : styles.primary}
                disabled={!hasSession}
                title={hasSession ? undefined : CHAIN_TEXT.noAgent}
                onClick={() => void handConflictsToAgent(worktree)}
              >
                {CHAIN_LABEL.handoff(handoffAgent)}
              </button>
            ) : null}
            {canRetry && (
              <button type="button" className={styles.primary} disabled={blocker !== null} title={blocker ?? undefined} onClick={goAhead}>
                重试
                {showFields && <span className={styles.shortcut}>⌘↵</span>}
              </button>
            )}
          </>
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

/** Under the failed step: what went wrong in plain words and, for a hook or a repository rule, what it printed (Figma
 *  73E). Without an agent session 交给 agent is disabled; no caption says so (the button carries it). */
function StepFailure({ state }: { state: ShipState }) {
  const error = state.error!
  const output = failureOutput(error)
  return (
    <span className={styles.failure} role="alert">
      <span className={styles.failureText}>{error.message}</span>
      {output && <pre className={styles.output}>{output}</pre>}
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
