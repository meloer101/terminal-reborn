// 设置 · 额度 (PRD F11 · 额度页, Figma 33E / 33H): every installed agent's plan usage in one place, the fullest vendor
// first. Claude and Codex list their windows (session-meta/UsageRows); a vendor without figures says why in
// one word; the other agents say 暂不支持. Opening the page asks every account once (main keeps its own limits). The
// sidebar's 额度 and ⇧⌘U open settings here. 额度提醒 lives here too.
import { useEffect, useState } from 'react'
import { CLI_AGENTS, agentName } from '@shared/agents'
import type { AgentAvailability } from '@shared/ipc'
import { orderByTightest, vendorStatus, VENDOR_LABEL, windowKey, type UsageVendor } from '@shared/session-meta'
import type { AlertSettings } from '@shared/settings'
import { useMetaNow } from '../session-meta/MetaChips'
import { useSessionMeta } from '../session-meta/store'
import { UsageAgentRow, UsageWindowRow } from '../session-meta/UsageRows'
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
                <UsageAgentRow agent={vendor} name={VENDOR_LABEL[vendor]} status={text} />
                {windows.map((w) => (
                  <UsageWindowRow key={windowKey(w)} vendor={vendor} w={w} now={now} testIdPrefix="usage-page-window" />
                ))}
              </section>
            )
          })}
          {others.map((id) => (
            <section key={id} className={styles.group} aria-label={agentName(id)}>
              <UsageAgentRow agent={id} name={agentName(id)} status="暂不支持" />
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
