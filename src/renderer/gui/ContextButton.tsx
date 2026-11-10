// The GUI composer's context ring (PRD F23, Figma 52F / 52G): under the send button, filled as far as the session's
// context window is used. A click opens, above it, the context row and the current agent's plan windows in the 设置 ·
// 额度 rows (Figma 33I) — what the session header's context and usage chips show for a CLI session. No figures, no ring.
import { useCallback, useEffect, useRef, useState } from 'react'
import { usageVendor } from '@shared/agents'
import { contextHigh, VENDOR_LABEL, vendorStatus, windowKey, type ContextUsage } from '@shared/session-meta'
import type { AgentKind, SessionId } from '@shared/types'
import { useMetaNow } from '../session-meta/MetaChips'
import { Popover } from '../session-meta/Popover'
import { useSessionMeta } from '../session-meta/store'
import { UsageAgentRow, UsageContextRow, UsageWindowRow } from '../session-meta/UsageRows'
import styles from './Chat.module.css'

const RADIUS = 7
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function ContextButton({ sessionId, agent }: { sessionId: SessionId; agent: AgentKind }) {
  const context = useSessionMeta((s) => s.bySession[sessionId]?.context)
  // Off the plan (a third-party endpoint), the account's usage is not this session's.
  const onPlan = useSessionMeta((s) => s.bySession[sessionId]?.plan !== false)
  const vendor = onPlan ? usageVendor(agent) : null
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  if (!context && !vendor) return null
  const percent = context?.percent ?? 0
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={styles.barIcon}
        aria-label={context ? `context 已用 ${percent}%` : 'context 和额度'}
        title={context ? `context 已用 ${percent}%` : 'context 和额度'}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="gui-context-ring"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width={16} height={16} viewBox="0 0 16 16" className={styles.ring} data-level={context && contextHigh(context) ? 'high' : 'normal'} aria-hidden>
          <circle className={styles.ringTrack} cx={8} cy={8} r={RADIUS} />
          {percent > 0 && <circle className={styles.ringUsed} cx={8} cy={8} r={RADIUS} strokeDasharray={`${(Math.min(100, percent) / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`} />}
        </svg>
      </button>
      {open && (
        <Popover anchor={anchor} label="context 和额度" onClose={close} placement="above-end" className={styles.contextPopover} testId="gui-context-popover">
          <ContextPanel context={context} vendor={vendor} />
        </Popover>
      )}
    </>
  )
}

function ContextPanel({ context, vendor }: { context: ContextUsage | undefined; vendor: ReturnType<typeof usageVendor> }) {
  const now = useMetaNow()
  const usage = useSessionMeta((s) => (vendor ? s.usage[vendor] : undefined))
  const account = useSessionMeta((s) => (vendor ? s.accounts[vendor] : undefined))
  // Opening the panel asks the account for fresh figures (main keeps its own minimum gap per vendor).
  useEffect(() => window.tr.agent.refreshUsage(), [])
  const status = vendor ? vendorStatus(usage, account, now) : null
  return (
    <div className={styles.contextPanel}>
      {context && <UsageContextRow context={context} />}
      {vendor && status && (
        <section className={styles.contextVendor} aria-label={VENDOR_LABEL[vendor]}>
          <UsageAgentRow agent={vendor} name={VENDOR_LABEL[vendor]} status={status.text} />
          {status.windows.map((w) => (
            <UsageWindowRow key={windowKey(w)} vendor={vendor} w={w} now={now} testIdPrefix="gui-usage-window" />
          ))}
        </section>
      )}
    </div>
  )
}
