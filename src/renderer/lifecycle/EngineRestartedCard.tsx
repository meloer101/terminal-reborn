import { useEffect, useState } from 'react'
import { useWorkspace } from '../state/workspace'
import { StatusGlyph } from '../ui/StatusGlyph'
import { lostSessionIds, recoverLostSessions, startHostRestartTracking, useHostRestart } from './host-restart'
import { usePaneView } from '../state/window-scope'
import styles from './EngineRestartedCard.module.css'

/**
 * Figma Screen 10 "Engine restarted" (64:2344): shown in each session the pty-host crash took down.
 * The terminal process is gone but the workspace is intact; 全部恢复 respawns every affected session.
 */
export function EngineRestartedCard() {
  useEffect(() => startHostRestartTracking(), [])
  const [busy, setBusy] = useState(false)
  const sessions = useWorkspace((s) => s.sessions)
  // This window's active session (F20 · 多窗口).
  const activeId = usePaneView().activeSessionId
  const lost = useHostRestart((s) => s.lost)
  const lostIds = lostSessionIds(lost, sessions)
  if (!activeId || !lostIds.includes(activeId)) return null

  const recover = () => {
    setBusy(true)
    void recoverLostSessions().finally(() => setBusy(false))
  }

  return (
    <div className={styles.card} role="status" data-testid="engine-restarted">
      <span className={styles.glyph}>
        <StatusGlyph status="error" />
      </span>
      <div className={styles.text}>
        <p className={styles.title}>终端进程意外退出，已自动重启</p>
        <p className={styles.detail}>{lostIds.length} 个会话需要恢复</p>
      </div>
      <button type="button" className={styles.primary} disabled={busy} onClick={recover}>
        全部恢复
      </button>
    </div>
  )
}
