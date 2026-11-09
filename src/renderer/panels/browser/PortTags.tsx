// `:5173` tags for a session (PRD F14), on the sidebar row and the overview.
// Click opens the built-in browser, ⌥-click the system browser, right-click asks main to end the process.
import { portUrl } from '@shared/browser'
import { openLink } from '../../state/link-actions'
import { useBrowser } from './store'
import styles from './PortTags.module.css'

/** Renders nothing when this session is not listening. */
export function PortTags({ sessionId, max = 2 }: { sessionId: string; max?: number }) {
  const ports = useBrowser((s) => s.ports[sessionId])
  // 自动打开 waits for the user to go to this worktree (auto-open.ts).
  const pending = useBrowser((s) => s.pendingPorts[sessionId])
  if (!ports || ports.length === 0) return null
  // A waiting port is never folded into +N.
  const waiting = ports.find((p) => p.port === pending)
  const first = ports.slice(0, max)
  const shown = waiting && !first.includes(waiting) ? [...first.slice(0, max - 1), waiting] : first
  const hidden = ports.filter((p) => !shown.includes(p))
  const rest = hidden.length
  return (
    <span className={styles.ports} data-testid="port-tags">
      {shown.map((p) => {
        const url = portUrl(p)
        const waiting = p.port === pending
        return (
          <button
            key={`${p.host}:${p.port}:${p.pid}`}
            type="button"
            className={styles.port}
            data-pending={waiting || undefined}
            title={`${waiting ? '新端口，切到这个会话时自动打开 · ' : ''}${p.label ? `${p.label} · ` : ''}在内置浏览器打开 ${url} · ⌥ 点击用系统浏览器打开 · 右键结束进程`}
            aria-label={`打开 ${url}`}
            onClick={(e) => {
              e.stopPropagation()
              // ctrl-click is the context-menu gesture on macOS; that path ends the process.
              if (e.button !== 0 || e.ctrlKey) return
              openLink(sessionId, url, e.altKey ? 'external' : 'internal')
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void window.tr.browser.endListener(sessionId, p.pid)
            }}
          >
            :{p.port}
          </button>
        )
      })}
      {rest > 0 && (
        <span className={styles.more} title={hidden.map((p) => `:${p.port}`).join(' ')}>
          +{rest}
        </span>
      )}
    </span>
  )
}
