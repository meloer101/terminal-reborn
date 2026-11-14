// 派活确认 (PRD F21, Figma 40B): an agent in a terminal session ran `wavi run`. The request belongs to its session, like a permission
// dialog: the session shows 等你处理 (status/bridge.ts) and this strip sits under its terminal, never over the window,
// so the other sessions stay usable. Every request of that session waiting at once is one row here — agent, name, the
// branch it gets (or 当前改动的快照), its task (a click shows all of it) — then 拒绝 / 开始. ⌘↵ starts while the strip
// is shown; Esc stays the terminal's (it interrupts the agent). 拒绝 tells the agent not to retry.
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, CircleAlert, Split } from 'lucide-react'
import { agentLabel } from '@shared/dispatch'
import type { SessionId } from '@shared/types'
import { useSessionView } from '../state/workspace'
import { AgentIcon } from '../ui/AgentIcon'
import { decideConfirms } from './handler'
import { useDispatch, type PendingStart } from './store'
import styles from './DispatchStrip.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const
const NONE: PendingStart[] = []

/** `active`: its pane has the keyboard. */
export function DispatchStrip({ sessionId, active }: { sessionId: SessionId; active: boolean }) {
  const session = useSessionView(sessionId)?.session
  // A GUI dispatcher answers in its chat: the fan-out graph where `wavi run` was called is the confirm (Figma 68′).
  const id = session && session.ui !== 'gui' ? session.id : null
  const confirms = useDispatch((s) => s.confirms)
  const pending = id ? confirms.filter((c) => c.parentId === id) : NONE
  return id && pending.length > 0 ? <Strip parentId={id} pending={pending} active={active} /> : null
}

function Strip({ parentId, pending, active }: { parentId: string; pending: readonly PendingStart[]; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<string | null>(null)
  const count = pending.length
  const uncommitted = pending.some((c) => c.uncommitted && c.plan.item.base === 'head')

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
      // Its own pane only (a split shows a strip under each pane that has one); nothing focused is the active pane's.
      const pane = strip.closest('[data-pane-box]')
      const fromHere = target !== null && (strip.contains(target) || (pane !== null && pane.contains(target)))
      if (!fromHere && !(active && target === strip.ownerDocument.body)) return
      event.preventDefault()
      event.stopPropagation()
      decideConfirms(parentId, true)
    }
    win.addEventListener('keydown', onKeyDown, true)
    return () => win.removeEventListener('keydown', onKeyDown, true)
  }, [parentId, active])

  return (
    <div ref={ref} className={styles.strip} role="region" aria-label={`想开 ${count} 个会话`} data-testid="dispatch-strip">
      <div className={styles.row}>
        <span className={styles.gutter}>
          <Split {...ICON} />
        </span>
        <span className={styles.title}>想开 {count} 个会话</span>
        <span className={styles.base}>基于 {pending[0]!.base}</span>
      </div>
      {uncommitted && (
        <div className={styles.row}>
          <span className={styles.gutter}>
            <CircleAlert {...ICON} />
          </span>
          <span className={styles.note}>未提交的改动不会带到新的 worktree 里</span>
        </div>
      )}
      {pending.map(({ callId, plan }) => {
        const expanded = open === callId
        const firstLine = plan.item.task.split('\n').find((l) => l.trim() !== '') ?? ''
        return (
          <div key={callId} data-testid="dispatch-row">
            <button type="button" className={styles.row} data-expanded={expanded} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : callId)}>
              <span className={styles.gutter} title={agentLabel(plan.item.agent)} data-agent={plan.item.agent}>
                <AgentIcon kind={plan.item.agent} size={12} />
              </span>
              <span className={styles.name}>{plan.item.title}</span>
              <span className={styles.branch}>{plan.branch || '当前改动的快照'}</span>
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
        <button type="button" className={styles.ghost} onClick={() => decideConfirms(parentId, false)}>
          拒绝
        </button>
        <button type="button" className={styles.primary} onClick={() => decideConfirms(parentId, true)} data-testid="dispatch-start">
          开始 {count} 个<span className={styles.shortcut}>⌘↵</span>
        </button>
      </div>
    </div>
  )
}
