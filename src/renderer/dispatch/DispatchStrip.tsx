// 派活确认 (PRD F21, Figma 40B): an agent asked to start sessions. The request belongs to its session, like a permission
// dialog: the session shows 等你处理 (status/bridge.ts) and this strip sits under its terminal, never over the window,
// so the other sessions stay usable. One 28-high row per session — agent, name, the branch it gets, its task (a click
// shows all of it) — then 拒绝 / 开始. ⌘↵ starts while the strip is shown; Esc stays the terminal's (it interrupts the
// agent). 拒绝 tells the agent not to retry.
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, CircleAlert, Split } from 'lucide-react'
import { DISPATCH_AGENTS } from '@shared/dispatch'
import { useActiveSession } from '../state/workspace'
import { AgentIcon } from '../ui/AgentIcon'
import { settleConfirm, useDispatch, type PendingStart } from './store'
import styles from './DispatchStrip.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

export function DispatchStrip() {
  const id = useActiveSession()?.session.id ?? null
  const pending = useDispatch((s) => (id ? s.confirms.find((c) => c.parentId === id) : undefined))
  return pending ? <Strip key={pending.callId} pending={pending} /> : null
}

function Strip({ pending }: { pending: PendingStart }) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<string | null>(null)
  const count = pending.plans.length

  // ⌘↵ from the terminal or the strip itself, while the strip is on screen. Not from a sheet, the overview or any other
  // field with a ⌘↵ of its own: starting sessions is not undone by pressing it in the wrong place. No key repeat.
  useEffect(() => {
    const strip = ref.current
    const win = strip?.ownerDocument.defaultView
    if (!strip || !win) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || !event.metaKey || event.shiftKey || event.altKey || event.ctrlKey) return
      if (event.isComposing || event.repeat || event.defaultPrevented || strip.offsetParent === null) return
      const target = event.target instanceof win.Element ? event.target : null
      const fromHere = target !== null && (strip.contains(target) || target.closest('[data-region="terminal"]') !== null)
      if (!fromHere && target !== strip.ownerDocument.body) return
      event.preventDefault()
      event.stopPropagation()
      settleConfirm(pending.callId, true)
    }
    win.addEventListener('keydown', onKeyDown, true)
    return () => win.removeEventListener('keydown', onKeyDown, true)
  }, [pending.callId])

  return (
    <div ref={ref} className={styles.strip} role="region" aria-label={`想开 ${count} 个会话`} data-testid="dispatch-strip">
      <div className={styles.row}>
        <span className={styles.gutter}>
          <Split {...ICON} />
        </span>
        <span className={styles.title}>想开 {count} 个会话</span>
        <span className={styles.base}>基于 {pending.base}</span>
        {pending.reason && <span className={styles.reason}>{pending.reason}</span>}
      </div>
      {pending.uncommitted && (
        <div className={styles.row}>
          <span className={styles.gutter}>
            <CircleAlert {...ICON} />
          </span>
          <span className={styles.note}>未提交的改动不会带到新的 worktree 里</span>
        </div>
      )}
      {pending.plans.map((plan) => {
        const expanded = open === plan.branch
        const firstLine = plan.item.task.split('\n').find((l) => l.trim() !== '') ?? ''
        return (
          <div key={plan.branch} data-testid="dispatch-row">
            <button
              type="button"
              className={styles.row}
              data-expanded={expanded}
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : plan.branch)}
            >
              <span className={styles.gutter} title={DISPATCH_AGENTS[plan.item.agent].name} data-agent={plan.item.agent}>
                <AgentIcon kind={plan.item.agent} size={12} />
              </span>
              <span className={styles.name}>{plan.item.title}</span>
              <span className={styles.branch}>{plan.branch}</span>
              <span className={styles.task}>{plan.item.model ? `${plan.item.model} · ${firstLine}` : firstLine}</span>
              <span className={styles.chevron}>
                <ChevronRight {...ICON} />
              </span>
            </button>
            {expanded && <pre className={styles.taskBody}>{plan.item.task}</pre>}
          </div>
        )
      })}
      <div className={styles.footer}>
        <button type="button" className={styles.ghost} onClick={() => settleConfirm(pending.callId, false)}>
          拒绝
        </button>
        <button type="button" className={styles.primary} onClick={() => settleConfirm(pending.callId, true)} data-testid="dispatch-start">
          开始 {count} 个<span className={styles.shortcut}>⌘↵</span>
        </button>
      </div>
    </div>
  )
}
