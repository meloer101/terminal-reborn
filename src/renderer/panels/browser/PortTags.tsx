// `:5173` tags for a session (PRD F14), on the sidebar row and the overview. Same quiet mono label as the browser port row.
import { useBrowser } from './store'
import styles from './PortTags.module.css'

/** Renders nothing when this session is not listening. */
export function PortTags({ sessionId, max = 2 }: { sessionId: string; max?: number }) {
  const ports = useBrowser((s) => s.ports[sessionId])
  if (!ports || ports.length === 0) return null
  const shown = ports.slice(0, max)
  const rest = ports.length - shown.length
  return (
    <span className={styles.ports} data-testid="port-tags">
      {shown.map((p) => (
        <span key={p.port} className={styles.port} title={p.label ? `:${p.port} ${p.label}` : `:${p.port}`}>
          :{p.port}
        </span>
      ))}
      {rest > 0 && (
        <span className={styles.more} title={ports.slice(max).map((p) => `:${p.port}`).join(' ')}>
          +{rest}
        </span>
      )}
    </span>
  )
}
