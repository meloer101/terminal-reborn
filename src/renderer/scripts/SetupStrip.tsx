import { CircleAlert } from 'lucide-react'
import { AGENT_NAME } from '../lifecycle/present'
import { useActiveSession, useWorkspace } from '../state/workspace'
import { StatusGlyph } from '../ui/StatusGlyph'
import { continueAfterSetup, dismissSetupNote, useSetupRuns } from './setup-runs'
import styles from './SetupStrip.module.css'

/**
 * Under the session, like the worktree-failed strip (PRD F4): the setup script failed — its output stays in the
 * terminal, and the agent starts when the user goes on — or it was not run because `.tr/settings.toml` is broken.
 */
export function SetupStrip() {
  const active = useActiveSession()
  const id = active?.session.id ?? null
  const run = useSetupRuns((s) => (id ? s.runs[id] : undefined))
  if (!active || !id || !run || (run.state !== 'failed' && run.state !== 'skipped')) return null
  const kind = active.session.kind

  if (run.state === 'skipped') {
    return (
      <div className={styles.bar} role="status" data-testid="setup-strip">
        <span className={styles.icon}>
          <CircleAlert size={16} strokeWidth={1.75} />
        </span>
        <p className={styles.title}>没有运行 setup 脚本：{run.reason}</p>
        <button type="button" className={styles.secondary} onClick={() => dismissSetupNote(id)}>
          知道了
        </button>
      </div>
    )
  }
  return (
    <div className={styles.bar} role="status" data-testid="setup-strip">
      <span className={styles.icon}>
        <StatusGlyph status="error" />
      </span>
      <p className={styles.title}>setup 脚本失败（退出码 {run.code}），输出留在终端里</p>
      <button
        type="button"
        className={styles.primary}
        onClick={() => {
          continueAfterSetup(id)
          useWorkspace.getState().requestTerminalFocus()
        }}
      >
        {kind === 'shell' ? '继续打开终端' : `仍然启动 ${AGENT_NAME[kind]}`}
      </button>
    </div>
  )
}
