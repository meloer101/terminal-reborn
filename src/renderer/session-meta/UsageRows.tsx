// Usage rows in the Figma 33I layout (PRD F11): an agent's row (mark · name · plan or why there are no figures) and a
// window's row (name · PaceMeter · used % · reset), all on one set of column lines. 设置 · 额度 lays them out in its 640
// column; the GUI composer's context popover (Figma 52G) narrows the columns through `--usage-columns` / `--usage-gap`
// and puts the session's context row on the same lines.
import type { CliAgent } from '@shared/agents'
import {
  contextHigh,
  formatClock,
  formatReset,
  formatTokens,
  isHigh,
  paceBar,
  windowKey,
  windowLabel,
  type ContextUsage,
  type UsageVendor,
  type UsageWindow
} from '@shared/session-meta'
import { AgentIcon } from '../ui/AgentIcon'
import { PaceMeter } from './MetaChips'
import meta from './SessionMeta.module.css'
import styles from './UsageRows.module.css'

/** The agent's mark sits on the column's left edge; the name follows it, where the window labels start (Figma 33I). */
export function UsageAgentRow({ agent, name, status }: { agent: CliAgent; name: string; status: string }) {
  return (
    <div className={styles.agentRow}>
      <span className={styles.lead}>
        <span className={styles.icon}>
          <AgentIcon kind={agent} />
        </span>
        <span className={styles.name}>{name}</span>
      </span>
      <span className={styles.status}>{status}</span>
    </div>
  )
}

export function UsageWindowRow({ vendor, w, now, testIdPrefix }: { vendor: UsageVendor; w: UsageWindow; now: number; testIdPrefix: string }) {
  const bar = paceBar(w, now)
  const level = bar.exhausted ? 'exhausted' : bar.ahead || isHigh(w.percent) ? 'ahead' : 'normal'
  return (
    <div className={styles.windowRow} data-level={level} data-testid={`${testIdPrefix}-${vendor}-${windowKey(w).replace(':', '-')}`}>
      <span className={styles.windowLabel}>{windowLabel(vendor, w.minutes, w.scope)}</span>
      <PaceMeter w={w} now={now} />
      <span className={styles.value}>{w.percent}%</span>
      <span className={styles.reset}>{w.resetsAt === undefined ? '' : bar.exhausted ? `${formatClock(w.resetsAt, now)} 恢复` : formatReset(w.resetsAt, now)}</span>
    </div>
  )
}

/** Figma 52G: `context` · the used part of the window · used % · used / window size; heavier where the agent warns. */
export function UsageContextRow({ context }: { context: ContextUsage }) {
  const tokens = context.usedTokens !== undefined && context.windowTokens !== undefined ? `${formatTokens(context.usedTokens)} / ${formatTokens(context.windowTokens)}` : ''
  return (
    <div className={styles.windowRow} data-level={contextHigh(context) ? 'ahead' : 'normal'} data-testid="usage-context-row">
      <span className={styles.contextLabel}>context</span>
      <span className={meta.paceMeter} data-exhausted={contextHigh(context)} aria-hidden>
        <span className={meta.paceUsed} style={{ width: `${Math.min(100, Math.max(0, context.percent))}%` }} />
      </span>
      <span className={styles.value}>{context.percent}%</span>
      <span className={styles.reset}>{tokens}</span>
    </div>
  )
}
