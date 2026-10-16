// Overview preview (Space) — Figma 11c. A read-only text snapshot of the session's terminal (no second
// xterm / WebGL context), its pending permission or question answered in place, and a one-line reply.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CornerDownLeft, X } from 'lucide-react'
import type { Session } from '@shared/types'
import { AGENT_NAME } from '../lifecycle/present'
import { SessionPromptBar } from '../prompt-bar/PromptBar'
import { submitPrompt } from '../session-io'
import { useWorkspace } from '../state/workspace'
import { readSnapshot } from '../terminal/registry'
import { IconButton } from '../ui/IconButton'
import { StatusGlyph } from '../ui/StatusGlyph'
import { glyphStatus } from '../lifecycle/present'
import { tailLines } from './model'
import { enterSession } from './store'
import styles from './Peek.module.css'

const SNAPSHOT_LINES = 18
const REFRESH_MS = 250

/**
 * Snapshot text, refreshed (throttled) while the session prints. Null: its terminal was never opened.
 * The caller keys the panel by session, so `sessionId` never changes for one mounted hook.
 */
function useSnapshot(sessionId: string): string | null {
  const [text, setText] = useState(() => readSnapshot(sessionId))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.tr?.pty.onData(sessionId, () => {
      timer ??= setTimeout(() => {
        timer = null
        setText(readSnapshot(sessionId))
      }, REFRESH_MS)
    })
    return () => {
      off?.()
      if (timer) clearTimeout(timer)
    }
  }, [sessionId])
  return text === null ? null : tailLines(text, SNAPSHOT_LINES)
}

export function Peek({ session, onClose }: { session: Session; onClose(): void }) {
  const worktree = useWorkspace((s) => s.worktrees.find((w) => w.id === session.worktreeId))
  const project = useWorkspace((s) => s.projects.find((p) => p.id === worktree?.projectId))
  const snapshot = useSnapshot(session.id)
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string | null>(null)
  const sending = useRef(false)
  const canReply = session.phase === undefined || session.phase === 'ready'
  const where = [project?.name, worktree?.branch].filter(Boolean).join(' › ')

  const send = async () => {
    const text = reply
    if (!text.trim() || sending.current) return
    sending.current = true
    setError(null)
    setReply('')
    try {
      await submitPrompt(session.id, text)
    } catch (e) {
      setReply(text)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      sending.current = false
    }
  }

  const onReplyKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Never send while an IME is composing (keyCode 229 covers Safari-style events).
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    e.stopPropagation()
    void send()
  }

  return (
    <aside className={styles.peek} aria-label={`预览：${session.title}`} data-region="overview-peek">
      <header className={styles.header}>
        <StatusGlyph status={glyphStatus(session)} />
        <span className={styles.titles}>
          <span className={styles.title}>{session.title}</span>
          <span className={styles.where}>{[where, AGENT_NAME[session.kind]].filter(Boolean).join(' · ')}</span>
        </span>
        <button type="button" className={styles.enter} onClick={() => enterSession(session.id)}>
          进入会话
          <CornerDownLeft size={14} strokeWidth={1.75} aria-hidden />
        </button>
        <IconButton label="关闭预览" onClick={onClose}>
          <X size={16} strokeWidth={1.75} />
        </IconButton>
      </header>
      <pre className={styles.snapshot} aria-label="终端最近的输出" data-testid="peek-snapshot">
        {snapshot ?? <span className={styles.none}>还没有打开过这个会话的终端。进入会话后，这里会显示它最近的输出。</span>}
      </pre>
      <div className={styles.dock}>
        <SessionPromptBar session={session} />
        <div className={styles.reply} data-disabled={!canReply}>
          <textarea
            rows={1}
            value={reply}
            disabled={!canReply}
            placeholder={canReply ? `回复 ${AGENT_NAME[session.kind]}，↵ 发送` : '会话未就绪，进入会话后再回复'}
            aria-label="回复"
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={onReplyKeyDown}
          />
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </aside>
  )
}
