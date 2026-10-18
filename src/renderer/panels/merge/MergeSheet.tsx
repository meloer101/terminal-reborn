// 合并到 <base> (PRD F4, Figma 05 19:814): the precheck as a short checklist (ahead, behind, conflicts, uncommitted
// work, an upstream the base has not pulled), then the method (Squash · Merge · Rebase) and two options (remove the
// worktree, push to origin). With conflicts the only way forward is the worktree's agent: the instructions go into its
// input line, unsent. Nothing is changed until 合并 is pressed. Glass sheet material as the new-session sheet (PRD §5).
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ArrowRight, Check, CircleAlert, CircleX, GitBranch } from 'lucide-react'
import type { MergeMethod, MergePrecheck, MergeResult } from '@shared/git-merge'
import { ensureAgentUp } from '../../lifecycle/agent-up'
import { insertIntoTerminal } from '../../session-io'
import { useWorkspace } from '../../state/workspace'
import { Segmented } from '../../ui/Segmented'
import { removeFailureText, removeWorktreeWithSessions } from '../worktree/actions'
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
  type CheckLine
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
  const sheetRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  const ids = target.worktreeIds
  const sessions = useWorkspace((s) => s.sessions)
  const activeId = useWorkspace((s) => s.activeSessionId)
  const here = sessions.filter((s) => ids.includes(s.worktreeId))
  const agent = agentSessionFor(here, activeId)

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
  const mergeable = ready !== null && ready.blocker === null && ready.conflicts.length === 0
  const removeReason = ready ? removeBlocker(ready, here, target.isMain) : null
  const willRemove = removeAfter && removeReason === null
  const willPush = push && (ready?.hasOrigin ?? false)

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
    setPhase({ kind: 'done', check: ready, lines: resultLines(result, ready.base, removal) })
  }

  const handToAgent = async (): Promise<void> => {
    if (!ready || !agent) return
    setFailure(null)
    const prompt = conflictPrompt(ready)
    closeMergeSheet(false)
    const state = useWorkspace.getState()
    state.setActiveSession(agent.id)
    try {
      await ensureAgentUp(agent.id)
      // Into the input line only: resolving conflicts can cost a lot of tokens, so the user sends it (PRD §2).
      await insertIntoTerminal(agent.id, prompt)
      useWorkspace.getState().requestTerminalFocus()
    } catch {
      // The terminal shows what happened; the sheet is gone by now.
    }
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
        aria-busy={phase.kind === 'checking' || busy}
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
          {shown && phase.kind !== 'done' && checkLines(shown).map((line) => <Line key={line.text} line={line} />)}
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
              <button type="button" className={styles.primary} onClick={() => void handToAgent()}>
                交给 {agentLabel(agent.kind)} 解决
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
  return (
    <p className={styles.line} data-tone={line.tone}>
      <span className={styles.lineIcon}>
        {line.tone === 'ok' ? <Check {...ICON} /> : line.tone === 'warn' ? <CircleAlert {...ICON} /> : <CircleX {...ICON} />}
      </span>
      <span className={styles.lineText}>{line.text}</span>
      {line.meta && <span className={styles.lineMeta}>{line.meta}</span>}
    </p>
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
