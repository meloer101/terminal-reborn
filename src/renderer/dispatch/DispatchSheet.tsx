// 派活确认 (PRD F21 §2; no Figma frame yet, drawn like 15 新建会话): an agent asked to start sessions. One row per
// session — agent, name, the branch it gets, its task (expandable) — and exactly what 开始 does: new worktrees, the
// task sent to each, results reported to the dispatcher, the user's own quota. 拒绝 tells the agent not to retry.
import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { GitBranch } from 'lucide-react'
import { DISPATCH_AGENTS, isDispatchAgent, startNote } from '@shared/dispatch'
import { useWorkspace } from '../state/workspace'
import { settleConfirm, useDispatch, type PendingStart } from './store'
import styles from './DispatchSheet.module.css'

export function DispatchSheet() {
  const pending = useDispatch((s) => s.confirms[0])
  return pending ? <Sheet key={pending.callId} pending={pending} /> : null
}

function Sheet({ pending }: { pending: PendingStart }) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const parent = useWorkspace((s) => s.sessions.find((x) => x.id === pending.parentId))
  const parentTitle = parent?.title ?? '未命名'
  const agentName = parent && isDispatchAgent(parent.kind) ? DISPATCH_AGENTS[parent.kind].name : 'agent'
  const count = pending.plans.length

  useEffect(() => sheetRef.current?.focus(), [])

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      settleConfirm(pending.callId, false)
    } else if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault()
      settleConfirm(pending.callId, true)
    }
  }

  return (
    <div className={styles.scrim} data-region="dispatch-sheet">
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="dispatch-sheet"
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            「{parentTitle}」想开 {count} 个会话
          </h2>
          <p className={styles.context}>
            {agentName} 派活 · 基于 {pending.base}
          </p>
          {pending.reason && <p className={styles.reason}>{pending.reason}</p>}
        </header>

        <ol className={styles.rows}>
          {pending.plans.map((plan) => (
            <li key={plan.branch} className={styles.row} data-testid="dispatch-row">
              <div className={styles.rowHead}>
                <span className={styles.agent}>{DISPATCH_AGENTS[plan.item.agent].name}</span>
                <span className={styles.name}>{plan.item.title}</span>
                {plan.item.model && <span className={styles.model}>{plan.item.model}</span>}
              </div>
              <div className={styles.branch}>
                <GitBranch size={12} strokeWidth={1.75} aria-hidden />
                {plan.branch}
              </div>
              <details className={styles.task}>
                <summary>{plan.item.task.split('\n').find((l) => l.trim() !== '') ?? ''}</summary>
                <pre className={styles.taskBody}>{plan.item.task}</pre>
              </details>
            </li>
          ))}
        </ol>

        <div className={styles.notes}>
          <p className={styles.note}>{startNote(count, parentTitle)}</p>
          {pending.uncommitted && <p className={styles.note}>「{parentTitle}」的未提交改动不会带到新的 worktree 里。</p>}
        </div>

        <footer className={styles.footer}>
          <button type="button" className={styles.cancel} onClick={() => settleConfirm(pending.callId, false)}>
            拒绝
          </button>
          <button type="button" className={styles.primary} onClick={() => settleConfirm(pending.callId, true)} data-testid="dispatch-start">
            开始 {count} 个
            <span className={styles.shortcut}>⌘↵</span>
          </button>
        </footer>
      </div>
    </div>
  )
}
