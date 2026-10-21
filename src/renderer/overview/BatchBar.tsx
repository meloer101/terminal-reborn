// 总览批量操作 (PRD F9 v1.59; no Figma frame yet): with sessions picked (⌘ / ⇧ click) a bar at the bottom of the
// overview offers 发送消息… · 停止 N 个 · 关闭 N 个. Every button names how many it reaches; 发送消息 first opens a box
// for the text, which lists exactly who gets it, and nothing is typed into any agent before the confirmation that
// quotes the text and names every recipient (PRD §2). Sessions an action cannot reach are skipped and said so.
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import {
  batchButtonLabel,
  batchConfirmation,
  batchPlan,
  batchResultText,
  MAX_BROADCAST_TEXT,
  recipientsLine,
  skippedText,
  type BatchAction,
  type BatchCandidate
} from '@shared/batch-actions'
import type { SessionId } from '@shared/types'
import { ensureAgentUp } from '../lifecycle/agent-up'
import { interruptAgent, submitPrompt } from '../session-io'
import { useWorkspace } from '../state/workspace'
import { IconButton } from '../ui/IconButton'
import enterStyles from './EnterButton.module.css'
import styles from './BatchBar.module.css'

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export function BatchBar({ ids, onClear, onSettled }: { ids: readonly SessionId[]; onClear(): void; /** The keyboard goes back to the list. */ onSettled(): void }) {
  const { sessions, worktrees } = useWorkspace(useShallow((s) => ({ sessions: s.sessions, worktrees: s.worktrees })))
  const candidates = useMemo(() => {
    const picked = ids.flatMap((id) => sessions.filter((x) => x.id === id))
    // 一题多解's members share a title: their branch tells them apart in the recipients and the confirmation.
    const repeated = (title: string) => picked.filter((x) => x.title === title).length > 1
    return picked.map((s): BatchCandidate => {
      const branch = worktrees.find((w) => w.id === s.worktreeId)?.branch
      const title = repeated(s.title) && branch ? `${s.title}（${branch}）` : s.title
      return { id: s.id, kind: s.kind, title, status: s.status, ...(s.phase ? { phase: s.phase } : {}) }
    })
  }, [ids, sessions, worktrees])
  const [composing, setComposing] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<BatchAction | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (composing) textRef.current?.focus()
  }, [composing])

  const send = batchPlan('send', candidates)
  const stop = batchPlan('stop', candidates)
  const close = batchPlan('close', candidates)

  const run = async (action: BatchAction): Promise<void> => {
    const plan = action === 'send' ? send : action === 'stop' ? stop : close
    const confirm = batchConfirmation(plan, text)
    if (!confirm || busy) return
    if (!(await window.tr.ui.confirm(confirm))) return
    setBusy(action)
    setResult(null)
    const failures: Array<{ title: string; message: string }> = []
    let done = 0
    if (action === 'close') {
      for (const target of plan.targets) useWorkspace.getState().closeSession(target.id)
      done = plan.targets.length
    } else {
      await Promise.all(
        plan.targets.map(async (target) => {
          try {
            if (action === 'send') {
              // A session restored from disk starts (resuming its conversation) before it takes the message.
              await ensureAgentUp(target.id)
              await submitPrompt(target.id, text)
            } else {
              await interruptAgent(target.id)
            }
            done++
          } catch (error) {
            failures.push({ title: target.title, message: message(error) })
          }
        })
      )
    }
    setBusy(null)
    setResult(batchResultText(action, done, failures))
    if (action === 'send' && failures.length === 0) {
      setComposing(false)
      setText('')
    }
    if (action === 'close') onClear()
    else onSettled()
  }

  const tooLong = text.length > MAX_BROADCAST_TEXT
  const canSend = send.targets.length > 0 && text.trim() !== '' && !tooLong
  const skipped = skippedText(send)

  return (
    <div className={styles.bar} role="toolbar" aria-label="批量操作" data-testid="batch-bar">
      <div className={styles.line}>
        <span className={styles.count}>已选 {candidates.length} 个</span>
        {!composing && (
          <>
            <button type="button" className={enterStyles.enter} disabled={send.targets.length === 0 || busy !== null} onClick={() => setComposing(true)} title={recipientsLine(send)}>
              发送消息…
            </button>
            <button
              type="button"
              className={enterStyles.enter}
              disabled={stop.targets.length === 0 || busy !== null}
              title={stop.targets.length > 0 ? `${recipientsLine(stop)}：向每个 agent 发送一次 Esc，先确认` : '选中的会话都没在运行'}
              onClick={() => void run('stop')}
            >
              {busy === 'stop' ? '正在停止…' : batchButtonLabel('stop', stop.targets.length)}
            </button>
            <button type="button" className={enterStyles.enter} disabled={busy !== null} title={`${recipientsLine(close)}，先确认`} onClick={() => void run('close')}>
              {batchButtonLabel('close', close.targets.length)}
            </button>
          </>
        )}
        {result && (
          <span className={styles.result} role="status">
            {result}
          </span>
        )}
        <span className={styles.spacer} />
        <IconButton label="取消选择" title="取消选择 · Esc" onClick={onClear}>
          <X size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
      {composing && (
        <div className={styles.compose}>
          <textarea
            ref={textRef}
            className={styles.textarea}
            aria-label="要发送的消息"
            placeholder="发给选中的每个 agent 的同一段话"
            value={text}
            rows={2}
            spellCheck={false}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter' && e.metaKey) {
                e.preventDefault()
                if (canSend) void run('send')
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setComposing(false)
                onSettled()
              }
            }}
          />
          <div className={styles.composeFoot}>
            <span className={styles.recipients} data-testid="batch-recipients">
              {recipientsLine(send)}
              {skipped && <span className={styles.skipped}> · {skipped}</span>}
              {tooLong && <span className={styles.skipped}> · 最多 {MAX_BROADCAST_TEXT} 个字</span>}
            </span>
            <span className={styles.spacer} />
            <button type="button" className={enterStyles.enter} onClick={() => setComposing(false)}>
              取消
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={!canSend || busy !== null}
              title="先确认，再把这段话发给每个会话并按回车（用你自己的额度）"
              onClick={() => void run('send')}
            >
              {busy === 'send' ? '正在发送…' : batchButtonLabel('send', send.targets.length)}
              <span className={styles.shortcut}>⌘↵</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
