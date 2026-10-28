// 设置 · 额度 (PRD F11 · 额度页, Figma 33E / 33H): every installed agent's plan usage in one place, the fullest vendor
// first. Claude and Codex list their windows (name · PaceMeter · used % · reset); a vendor without figures says why in
// one word; the other agents say 暂不支持. Opening the page asks every account once (main keeps its own limits). The
// sidebar's 额度 and ⇧⌘U open settings here. 额度提醒 lives here too.
import { useEffect, useState } from 'react'
import { CLI_AGENTS, agentName, type CliAgent } from '@shared/agents'
import type { AgentAvailability } from '@shared/ipc'
import {
  formatClock,
  formatReset,
  isHigh,
  orderByTightest,
  paceBar,
  vendorStatus,
  VENDOR_LABEL,
  windowKey,
  windowLabel,
  type UsageVendor,
  type UsageWindow
} from '@shared/session-meta'
import type { AlertSettings } from '@shared/settings'
import { PaceMeter, useMetaNow } from '../session-meta/MetaChips'
import { useSessionMeta } from '../session-meta/store'
import { AgentIcon } from '../ui/AgentIcon'
import { Row, Section, Toggle } from './controls'
import styles from './UsagePane.module.css'

const PLAN_VENDORS: readonly UsageVendor[] = ['claude', 'codex']

export function UsagePane({ alerts, updateAlerts }: { alerts: AlertSettings | null; updateAlerts: (patch: Partial<AlertSettings>) => void }) {
  const now = useMetaNow()
  const usage = useSessionMeta((s) => s.usage)
  const accounts = useSessionMeta((s) => s.accounts)
  const [found, setFound] = useState<AgentAvailability | null>(null)

  useEffect(() => {
    // Looking at the page asks every account now, vendors never used here included.
    window.tr.agent.refreshUsage(true)
    let live = true
    void window.tr.app
      .detectAgents()
      .then((next) => live && setFound(next))
      .catch(() => live && setFound({}))
    return () => {
      live = false
    }
  }, [])

  // A plan vendor is listed when its CLI is installed or its account said anything; the rest only when installed.
  const planRows = orderByTightest(
    PLAN_VENDORS.filter((v) => found?.[v] || usage[v] || (accounts[v] && accounts[v].state !== 'missing')).map((vendor) => ({ vendor })),
    usage,
    now
  )
  const others = found ? CLI_AGENTS.filter((id) => found[id] && !(PLAN_VENDORS as readonly string[]).includes(id)) : []

  return (
    <div className={styles.page}>
      <div className={styles.form}>
        <h1 className={styles.title}>额度</h1>
        <div className={styles.groups}>
          {planRows.map(({ vendor }) => {
            const { text, windows } = vendorStatus(usage[vendor], accounts[vendor], now)
            return (
              <section key={vendor} className={styles.group} aria-label={VENDOR_LABEL[vendor]} data-testid={`usage-page-${vendor}`}>
                <AgentRow agent={vendor} name={VENDOR_LABEL[vendor]} status={text} />
                {windows.map((w) => (
                  <WindowRow key={windowKey(w)} vendor={vendor} w={w} now={now} />
                ))}
              </section>
            )
          })}
          {others.map((id) => (
            <section key={id} className={styles.group} aria-label={agentName(id)}>
              <AgentRow agent={id} name={agentName(id)} status="暂不支持" />
            </section>
          ))}
        </div>
        {alerts && (
          <Section title="提醒">
            <Row label="用到 75%、90% 和用完时发通知">
              <Toggle label="用到 75%、90% 和用完时发通知" checked={alerts.usage} onChange={(on) => updateAlerts({ usage: on })} />
            </Row>
          </Section>
        )}
      </div>
    </div>
  )
}

/** The agent's mark hangs left of the text column, so every row starts with text (Figma 33E). */
function AgentRow({ agent, name, status }: { agent: CliAgent; name: string; status: string }) {
  return (
    <div className={styles.agentRow}>
      <span className={styles.icon}>
        <AgentIcon kind={agent} />
      </span>
      <span className={styles.name}>{name}</span>
      <span className={styles.status}>{status}</span>
    </div>
  )
}

function WindowRow({ vendor, w, now }: { vendor: UsageVendor; w: UsageWindow; now: number }) {
  const bar = paceBar(w, now)
  const level = bar.exhausted ? 'exhausted' : bar.ahead || isHigh(w.percent) ? 'ahead' : 'normal'
  return (
    <div className={styles.windowRow} data-level={level} data-testid={`usage-page-window-${vendor}-${windowKey(w).replace(':', '-')}`}>
      <span className={styles.windowLabel}>{windowLabel(vendor, w.minutes, w.scope)}</span>
      <PaceMeter w={w} now={now} />
      <span className={styles.value}>{w.percent}%</span>
      <span className={styles.reset}>{w.resetsAt === undefined ? '' : bar.exhausted ? `${formatClock(w.resetsAt, now)} 恢复` : formatReset(w.resetsAt, now)}</span>
    </div>
  )
}
