// 合并到 <base> (PRD F4, Figma 05 19:814): the precheck as a short checklist (ahead, behind, conflicts, uncommitted
// work, an upstream the base has not pulled), then the method (Squash · Merge · Rebase) and two options (remove the
// worktree, push to origin). With conflicts the only way forward is the worktree's agent: the instructions go into its
// input line, unsent. Nothing is changed until 合并 is pressed. Glass sheet material as the new-session sheet (PRD §5).
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ArrowRight, Check, CircleAlert, CircleX, GitBranch } from 'lucide-react'
import type { MergeMethod, MergePrecheck, MergeResult } from '@shared/git-merge'
import { archiveTargetFor, archiveWorktree } from '../../archive/actions'
import { ensureAgentUp } from '../../lifecycle/agent-up'
import { severityCounts } from '@shared/background-review'
import { cancelBackgroundReview, loadSavedReview, reviewLine, startBackgroundReview, useBackgroundReview } from '../../review/background'
import { useRepoScripts } from '../../scripts/run-script'
import { useSettings } from '../../settings/useSettings'
import { useReviewComments } from '../../state/review-comments'
import { insertIntoTerminal } from '../../session-io'
import { useWorkspace } from '../../state/workspace'
import { Segmented } from '../../ui/Segmented'
import { StatusGlyph } from '../../ui/StatusGlyph'
import { CheckMark, useTurnCheckView } from '../../turn-checks/TurnChecksTag'
import { runNote, type TurnCheckView } from '@shared/turn-checks'
import { removeFailureText, removeWorktreeWithSessions } from '../worktree/actions'
import { AfterMerge } from '../../attempts/AfterMerge'
import { attemptForWorktrees } from '../../attempts/actions'
import { markGroupMerged } from '../../state/attempt-groups'
import {
  agentLabel,
  agentSessionFor,
  checkLines,
  conflictPrompt,
  conflictReason,
  failureText,
  METHOD_NOTE,
  methodOptions,
  removeBlocker,
  resultLines,
  testBlocksMerge,
  testLine,
  turnChecksLine,
  type CheckLine,
  type MergeTestState
} from './model'
import { closeMergeSheet, useMergeSheet, type MergeTarget } from './store'
import styles from './MergeSheet.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const
/** Conflicted files listed in the sheet; the rest are counted. */
const MAX_LISTED_CONFLICTS = 8

export function MergeSheet() {
  const target = useMergeSheet((s) => s.target)
  const generation = useMergeSheet((s) => s.generation)
  return target ? <Sheet key={generation} target={target} /> : null
}

type Phase =
  | { kind: 'checking' }
  | { kind: 'failed-check'; message: string }
  | { kind: 'ready'; check: MergePrecheck }
  | { kind: 'merging'; check: MergePrecheck }
  | { kind: 'done'; check: MergePrecheck; lines: CheckLine[] }

function Sheet({ target }: { target: MergeTarget }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })
  const [method, setMethod] = useState<MergeMethod>('squash')
  const [removeAfter, setRemoveAfter] = useState(true)
  const [push, setPush] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // 交给 … 解决 in flight: the agent may have to start first, and the text may be refused while a menu is open.
  const [handing, setHanding] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(true)
  const titleId = useId()
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const ids = target.worktreeIds
  const sessions = useWorkspace((s) => s.sessions)
  const activeId = useWorkspace((s) => s.activeSessionId)
  const here = sessions.filter((s) => ids.includes(s.worktreeId))
  const agent = agentSessionFor(here, activeId)
  // 一题多解: read when the sheet opens — removing the worktree after the merge closes its session.
  const [attemptGroup] = useState(() => attemptForWorktrees(ids))

  // The precheck: once when the sheet opens, again after recheck() (the sheet opens in 'checking').
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    window.tr.gitWorktrees
      .mergePrecheck(target.root, target.worktreePath)
      .then((next) => {
        if (!live) return
        setPhase({ kind: 'ready', check: next })
        if (next.uncommitted !== 0) setMethod((m) => (m === 'rebase' ? 'squash' : m))
      })
      .catch((error: unknown) => live && setPhase({ kind: 'failed-check', message: error instanceof Error ? error.message : String(error) }))
    return () => {
      live = false
    }
  }, [target, attempt])

  const recheck = (): void => {
    setPhase({ kind: 'checking' })
    setAttempt((n) => n + 1)
  }

  useEffect(() => sheetRef.current?.focus(), [])

  const ready = phase.kind === 'ready' ? phase.check : null
  const gitMergeable = ready !== null && ready.blocker === null && ready.conflicts.length === 0
  const repo = useRepoScripts(target.worktreePath)
  const scriptsKnown = repo !== null
  const testScript = repo?.scripts.test
  const [testRun, setTestRun] = useState<{ attempt: number; script: string; state: MergeTestState } | null>(null)
  const [testAttempt, setTestAttempt] = useState(0)
  // Until this attempt reports back, the test is running. No setState for that: it is just the absence of a result.
  const reported = testRun && testRun.attempt === testAttempt && testRun.script === testScript ? testRun.state : null
  const testing = phase.kind === 'ready' && gitMergeable && testScript !== undefined
  const testState: MergeTestState | null = testing ? (reported ?? { status: 'running', command: testScript }) : phase.kind === 'merging' ? reported : null

  // Git precheck first. When it can merge and the repo names `test`, run that before 合并 is offered.
  // Closing the sheet (cleanup) kills the process. 重新运行 bumps testAttempt.
  useEffect(() => {
    if (!testing || testScript === undefined) return
    let live = true
    const command = testScript
    const attempt = testAttempt
    const dir = target.worktreePath
    void (async () => {
      try {
        const approval = await window.tr.repoScripts.approve(dir, 'test')
        if (!live) return
        if (approval !== 'approved') {
          setTestRun({ attempt, script: command, state: { status: 'declined', command } })
          return
        }
        const result = await window.tr.repoScripts.run(dir, 'test')
        if (!live || result.cancelled) return
        const state: MergeTestState =
          result.code === 0
            ? { status: 'passed', command }
            : { status: 'failed', command, code: result.code, output: result.output }
        setTestRun({ attempt, script: command, state })
      } catch (error) {
        if (!live) return
        setTestRun({
          attempt,
          script: command,
          state: { status: 'failed', command, code: null, output: error instanceof Error ? error.message : String(error) }
        })
      }
    })()
    return () => {
      live = false
      void window.tr.repoScripts.cancel(dir)
    }
  }, [testing, testScript, testAttempt, target.worktreePath])

  const mergeable = gitMergeable && scriptsKnown && !testBlocksMerge(testState, testScript !== undefined)
  const removeReason = ready ? removeBlocker(ready, here, target.isMain) : null
  const willRemove = removeAfter && removeReason === null
  const willPush = push && (ready?.hasOrigin ?? false)

  // Background review (PRD F13): one more checklist line, never a reason not to merge. 合并前 starts it when the
  // sheet is ready, 推送前 when 推送到 origin is ticked; 先审阅 starts it by hand. Main skips a diff it already reviewed.
  const { settings, loaded: settingsLoaded } = useSettings()
  const builtin = settings.review.mode === 'builtin'
  const reviewAgent = agent && (agent.kind === 'claude' || agent.kind === 'codex') ? agent.kind : null
  const review = useBackgroundReview((s) => s.byRoot[target.worktreePath])
  const reviewComments = useReviewComments((s) => s.byRoot[target.worktreePath])
  const autoTrigger = !settingsLoaded || !builtin ? null : settings.review.beforeMerge ? 'merge' : settings.review.beforePush && willPush ? 'push' : null
  const reviewBase = ready?.base
  useEffect(() => loadSavedReview(target.worktreePath), [target.worktreePath])
  useEffect(() => {
    if (!autoTrigger || !reviewAgent || !reviewBase) return
    void startBackgroundReview(target.worktreePath, reviewAgent, autoTrigger, reviewBase).catch(() => {})
  }, [autoTrigger, reviewAgent, reviewBase, target.worktreePath])
  const reviewCheck = review ? reviewLine(review, severityCounts((reviewComments ?? []).filter((c) => c.origin === 'review')), reviewAgent ?? undefined) : null
  const reviewRunning = review?.phase === 'running'
  const checksView = useTurnCheckView(agent?.id)

  const merge = async (): Promise<void> => {
    if (!ready || !mergeable) return
    setFailure(null)
    setNote(null)
    setPhase({ kind: 'merging', check: ready })
    const title = here.find((s) => s.id === agent?.id)?.title ?? here[0]?.title
    let result: MergeResult
    try {
      result = await window.tr.gitWorktrees.merge({
        root: target.root,
        worktree: target.worktreePath,
        method,
        head: ready.head,
        baseHead: ready.baseHead,
        push: willPush,
        ...(method === 'squash' && title ? { title } : {})
      })
    } catch (error) {
      result = { ok: false, reason: 'git', message: error instanceof Error ? error.message : String(error) }
    }
    if (!result.ok) {
      if (result.reason === 'stale') {
        setNote('分支或基线在检查之后又变了，已重新检查')
        recheck()
        return
      }
      setFailure(failureText(result, ready))
      setPhase({ kind: 'ready', check: ready })
      return
    }
    let removal: string | null = null
    if (willRemove) {
      try {
        const removed = await removeWorktreeWithSessions(target.root, target.worktreePath, ids)
        removal = removed.ok ? 'removed' : removeFailureText(removed)
      } catch (error) {
        removal = error instanceof Error ? error.message : String(error)
      }
    }
    if (attemptGroup) markGroupMerged(attemptGroup.groupId, attemptGroup.sessionId, ready.branch)
    const lines = resultLines(result, ready.base, removal)
    // 设置 · Worktree · 合并后自动归档 (PRD F15): a worktree the merge kept is folded away; its archive script runs
    // after the usual approval, and a failing one does not stop the archive.
    if (settings.archive.afterMerge && removal !== 'removed' && !target.isMain && ids[0]) {
      const archiveTarget = archiveTargetFor(ids[0])
      const archived = archiveTarget
        ? await archiveWorktree(archiveTarget, { ignoreScriptFailure: true }).catch((error: unknown) => ({
            ok: false as const,
            stage: 'snapshot' as const,
            message: error instanceof Error ? error.message : String(error)
          }))
        : null
      if (archived?.ok) lines.push({ tone: 'ok', text: '已归档 worktree，可以在跳转（⌘K）的历史里恢复' })
      else if (archived) lines.push({ tone: 'warn', text: `没有归档：${archived.message}` })
    }
    setPhase({ kind: 'done', check: ready, lines })
  }

  // The sheet stays until the text is in the agent's input line: when it cannot go there (a menu is open in the
  // terminal, the agent did not start) the failure line says so and 交给 … 解决 can be pressed again.
  const handToAgent = async (): Promise<void> => {
    if (!ready || !agent || handing) return
    setFailure(null)
    setHanding(true)
    const prompt = conflictPrompt(ready)
    useWorkspace.getState().setActiveSession(agent.id)
    try {
      await ensureAgentUp(agent.id)
      // Into the input line only: resolving conflicts can cost a lot of tokens, so the user sends it (PRD §2).
      await insertIntoTerminal(agent.id, prompt)
    } catch (error) {
      if (mounted.current) {
        setFailure(`没有交给 ${agentLabel(agent.kind)}：${error instanceof Error ? error.message : String(error)}`)
        setHanding(false)
      }
      return
    }
    if (!mounted.current) return
    closeMergeSheet(false)
    useWorkspace.getState().requestTerminalFocus()
  }

  const primary = (): void => {
    if (phase.kind === 'done') closeMergeSheet(true)
    else if (mergeable) void merge()
    else if (ready && ready.conflicts.length > 0 && !ready.blocker && agent) void handToAgent()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return
    if (event.key === 'Escape' && phase.kind !== 'merging') {
      event.preventDefault()
      closeMergeSheet(true)
    } else if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault()
      primary()
    }
  }

  const onScrimMouseDown = (event: MouseEvent): void => {
    if (event.target === event.currentTarget && phase.kind !== 'merging') closeMergeSheet(true)
  }

  const shown = phase.kind === 'ready' || phase.kind === 'merging' || phase.kind === 'done' ? phase.check : null
  const busy = phase.kind === 'merging'
  const conflicts = shown && phase.kind !== 'done' ? shown.conflicts : []

  return (
    <div className={styles.scrim} onMouseDown={onScrimMouseDown} data-region="merge">
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={phase.kind === 'checking' || busy || handing}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="merge-sheet"
      >
        <header className={styles.context}>
          <h2 id={titleId} className={styles.title}>
            合并到 {shown?.base || '…'}
          </h2>
          {shown?.branch && (
            <p className={styles.branches}>
              <GitBranch {...ICON} />
              <span>{shown.branch}</span>
              <ArrowRight {...ICON} />
              <span>{shown.base}</span>
            </p>
          )}
        </header>

        <div className={styles.checks} aria-live="polite">
          {phase.kind === 'checking' && <p className={styles.muted}>正在检查…</p>}
          {phase.kind === 'failed-check' && <Line line={{ tone: 'error', text: `没能检查：${phase.message}` }} />}
          {phase.kind === 'done' && phase.lines.map((line) => <Line key={line.text} line={line} />)}
          {phase.kind === 'done' && attemptGroup && <AfterMerge groupId={attemptGroup.groupId} />}
          {shown && phase.kind !== 'done' && checkLines(shown).map((line) => <Line key={line.text} line={line} />)}
          {shown && phase.kind !== 'done' && reviewCheck && (
            <Line
              line={{
                tone: reviewCheck.tone === 'muted' ? 'warn' : reviewCheck.tone,
                text: reviewCheck.text,
                ...(reviewCheck.meta ? { meta: reviewCheck.meta } : {})
              }}
            />
          )}
          {shown && phase.kind !== 'done' && agent && checksView && <TurnChecks view={checksView} kind={agent.kind} />}
          {shown && phase.kind !== 'done' && testState && (
            <TestResult line={testLine(testState)} onRerun={() => setTestAttempt((n) => n + 1)} />
          )}
          {conflicts.length > 0 && (
            <ul className={styles.conflicts} aria-label="冲突的文件">
              {conflicts.slice(0, MAX_LISTED_CONFLICTS).map((c) => (
                <li key={c.path} className={styles.conflict}>
                  <span className={styles.conflictPath}>{c.path}</span>
                  <span className={styles.conflictReason}>{conflictReason(c)}</span>
                </li>
              ))}
              {conflicts.length > MAX_LISTED_CONFLICTS && (
                <li className={styles.conflictMore}>还有 {conflicts.length - MAX_LISTED_CONFLICTS} 个文件</li>
              )}
            </ul>
          )}
          {note && <p className={styles.muted}>{note}</p>}
        </div>

        {shown && phase.kind !== 'done' && mergeable && (
          <div className={styles.options}>
            <div className={styles.field} role="group" aria-label="合并方式">
              <span className={styles.label}>合并方式</span>
              <div className={styles.control}>
                <Segmented label="合并方式" value={method} options={methodOptions(shown)} onChange={setMethod} />
                <p className={styles.note}>{shown.uncommitted !== 0 && method !== 'rebase' ? `${METHOD_NOTE[method]}；有未提交的改动时不能 rebase` : METHOD_NOTE[method]}</p>
              </div>
            </div>
            <div className={styles.field}>
              <span className={styles.label} />
              <div className={styles.control}>
                <Checkbox
                  checked={willRemove}
                  disabled={removeReason !== null || busy}
                  onChange={setRemoveAfter}
                  label="合并后删除 worktree（保留分支）"
                  note={removeReason ?? (here.length > 0 ? `这里的 ${here.length} 个会话会一起关闭` : null)}
                />
                <Checkbox
                  checked={willPush}
                  disabled={!shown.hasOrigin || busy}
                  onChange={setPush}
                  label="合并后推送到 origin"
                  note={shown.hasOrigin ? null : '没有 origin 远程仓库'}
                />
              </div>
            </div>
          </div>
        )}

        {failure && (
          <p className={styles.failure} role="alert">
            <CircleX {...ICON} />
            {failure}
          </p>
        )}

        <footer className={styles.footer}>
          {conflicts.length > 0 && !shown?.blocker && (
            <span className={styles.footerNote}>
              {agent ? `说明会放进 ${agentLabel(agent.kind)} 的输入行，看过后按回车发送` : '在终端里解决冲突后重新打开'}
            </span>
          )}
          {phase.kind === 'ready' && builtin && reviewAgent && conflicts.length === 0 && (
            <button
              type="button"
              className={styles.cancel}
              title={reviewRunning ? undefined : `在后台用 ${agentLabel(reviewAgent)} 只读审阅（用你自己的额度），不影响合并`}
              onClick={() =>
                reviewRunning
                  ? cancelBackgroundReview(target.worktreePath)
                  : void startBackgroundReview(target.worktreePath, reviewAgent, 'manual', ready?.base).catch(() => {})
              }
            >
              {reviewRunning ? '取消审阅' : '先审阅'}
            </button>
          )}
          <span className={styles.spacer} />
          {phase.kind !== 'done' && (
            <button type="button" className={styles.cancel} disabled={busy} onClick={() => closeMergeSheet(true)}>
              取消
            </button>
          )}
          {phase.kind === 'done' ? (
            <button type="button" className={styles.primary} onClick={() => closeMergeSheet(true)}>
              完成
              <span className={styles.shortcut}>⌘↵</span>
            </button>
          ) : conflicts.length > 0 && !shown?.blocker ? (
            agent && (
              <button type="button" className={styles.primary} disabled={handing} onClick={() => void handToAgent()}>
                {handing ? `正在交给 ${agentLabel(agent.kind)}…` : `交给 ${agentLabel(agent.kind)} 解决`}
                <span className={styles.shortcut}>⌘↵</span>
              </button>
            )
          ) : (
            <button type="button" className={styles.primary} disabled={!mergeable || busy} onClick={() => void merge()}>
              {busy ? '正在合并…' : '合并'}
              <span className={styles.shortcut}>⌘↵</span>
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

function Line({ line }: { line: CheckLine }) {
  const icon =
    line.tone === 'ok' ? (
      <Check {...ICON} />
    ) : line.tone === 'warn' ? (
      <CircleAlert {...ICON} />
    ) : line.tone === 'working' ? (
      <StatusGlyph status="running" />
    ) : (
      <CircleX {...ICON} />
    )
  return (
    <p className={styles.line} data-tone={line.tone}>
      <span className={styles.lineIcon} aria-hidden={line.tone === 'working'}>
        {icon}
      </span>
      <span className={styles.lineText}>{line.text}</span>
      {line.meta && <span className={styles.lineMeta}>{line.meta}</span>}
    </p>
  )
}

/** Most runs a turn has are listed; the rest are counted. */
const MAX_LISTED_RUNS = 6

/** The agent's own checks this turn: the line, then each command with its mark (the failing ones first). */
function TurnChecks({ view, kind }: { view: TurnCheckView; kind: Parameters<typeof turnChecksLine>[1] }) {
  const order = { fail: 0, unknown: 1, pass: 2 } as const
  const runs = [...view.runs].sort((a, b) => order[a.outcome] - order[b.outcome] || a.at - b.at)
  return (
    <>
      <Line line={turnChecksLine(view, kind)} />
      {runs.length > 0 && (
        <ul className={styles.runs} aria-label="跑过的检查" data-testid="merge-turn-checks">
          {runs.slice(0, MAX_LISTED_RUNS).map((run) => {
            const note = runNote(run)
            return (
              <li key={`${run.kind} ${run.command}`} className={styles.run}>
                <CheckMark outcome={run.outcome} />
                <span className={styles.runCommand}>{run.command}</span>
                {note && <span className={styles.runNote}>{note}</span>}
              </li>
            )
          })}
          {runs.length > MAX_LISTED_RUNS && <li className={styles.conflictMore}>还有 {runs.length - MAX_LISTED_RUNS} 条</li>}
        </ul>
      )}
    </>
  )
}

function TestResult({ line, onRerun }: { line: ReturnType<typeof testLine>; onRerun(): void }) {
  return (
    <>
      <Line line={line} />
      {line.output && <pre className={styles.output}>{line.output}</pre>}
      {line.rerun && (
        <button type="button" className={styles.rerun} onClick={onRerun}>
          重新运行
        </button>
      )}
    </>
  )
}

function Checkbox({
  checked,
  disabled,
  onChange,
  label,
  note
}: {
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
  label: string
  note: string | null
}) {
  return (
    <div className={styles.checkboxRow}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        className={styles.checkbox}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.box} aria-hidden>
          {checked && <Check size={12} strokeWidth={2.5} />}
        </span>
        {label}
      </button>
      {note && <p className={styles.note}>{note}</p>}
    </div>
  )
}
