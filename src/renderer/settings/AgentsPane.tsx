// Settings · 智能体 (Figma 25B; agent marks and the copy button's edge from 35A, PRD v1.92; PRD F4 v1.68): the agent CLIs 新建会话 can start. 已安装 lists each with its version and
// whether Wavi knows its state exactly (准确: per-launch hooks or the terminal's program-status protocol) or only
// estimates it from the title (估计); 没装 offers the vendor's install command to copy — Wavi never installs anything.
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { AGENT_SPECS, CLI_AGENTS, type CliAgent } from '@shared/agents'
import type { AgentAvailability, AgentVersions } from '@shared/ipc'
import { AgentIcon } from '../ui/AgentIcon'
import { agentStatusNote, statusAccuracy } from './agents-model'
import { Section } from './controls'
import styles from './AgentsPane.module.css'

/** Not-installed CLIs shown before 显示其余 N 家. */
const SHOWN_MISSING = 2

export function AgentsPane() {
  const [found, setFound] = useState<AgentAvailability | null>(null)
  const [versions, setVersions] = useState<AgentVersions>({})
  const [allMissing, setAllMissing] = useState(false)
  const [copied, setCopied] = useState<CliAgent | null>(null)

  useEffect(() => {
    let live = true
    void window.tr.app
      .detectAgents()
      .then((next) => live && setFound(next))
      .catch(() => live && setFound({}))
    void window.tr.app
      .agentVersions()
      .then((next) => live && setVersions(next))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const installed = found ? CLI_AGENTS.filter((id) => found[id]) : []
  const missing = found ? CLI_AGENTS.filter((id) => !found[id]) : []
  const shownMissing = allMissing ? missing : missing.slice(0, SHOWN_MISSING)
  const rest = missing.slice(SHOWN_MISSING)

  const copy = (id: CliAgent): void => {
    void navigator.clipboard
      .writeText(AGENT_SPECS[id].install)
      .then(() => setCopied(id))
      .catch(() => {})
  }

  return (
    <div className={styles.page}>
      <div className={styles.form}>
        <h1 className={styles.title}>智能体</h1>
        <p className={styles.lead}>
          新建会话时能选的智能体。每次启动时 Wavi 只给这一个会话注入状态 hooks，不改它们的全局配置。“准确”= 知道它在跑、在等你批准还是做完了；“估计”= 只能看终端状态协议和标题。
        </p>
        {found === null ? (
          <p className={styles.hint}>正在查找…</p>
        ) : (
          <>
            <Section title="已安装">
              {installed.length === 0 && <p className={styles.hint}>一个都没有找到。</p>}
              {installed.map((id) => {
                const note = agentStatusNote(id, versions[id] ?? null)
                return (
                  <div key={id} className={styles.agentRow} role="group" aria-label={AGENT_SPECS[id].label} data-agent={id}>
                    <span className={styles.agentText}>
                      <AgentName id={id} />
                      {note && <span className={styles.agentNote}>{note}</span>}
                    </span>
                    {versions[id] && <span className={styles.meta}>{versions[id]}</span>}
                    <span className={styles.meta}>状态 {statusAccuracy(id, versions[id] ?? null)}</span>
                  </div>
                )
              })}
            </Section>
            {missing.length > 0 && (
              <Section title={`没装 · ${missing.length} 家`}>
                {shownMissing.map((id) => (
                  <div key={id} className={styles.agentRow} role="group" aria-label={AGENT_SPECS[id].label} data-agent={id}>
                    <span className={styles.agentText}>
                      <AgentName id={id} />
                      <span className={styles.command}>{AGENT_SPECS[id].install}</span>
                    </span>
                    <button type="button" className={styles.copy} onClick={() => copy(id)}>
                      {copied === id ? '已复制' : '复制安装命令'}
                    </button>
                  </div>
                ))}
                {rest.length > 0 && (
                  <button type="button" className={styles.more} aria-expanded={allMissing} onClick={() => setAllMissing(!allMissing)}>
                    {allMissing ? <ChevronDown size={16} strokeWidth={1.75} aria-hidden /> : <ChevronRight size={16} strokeWidth={1.75} aria-hidden />}
                    {allMissing ? '收起' : `显示其余 ${rest.length} 家（${rest.map((id) => AGENT_SPECS[id].label).join('、')}）`}
                  </button>
                )}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** The CLI's mark on the section's left edge, its name after it (Figma 35A, as 设置 · 额度 in 33I). */
function AgentName({ id }: { id: CliAgent }) {
  return (
    <span className={styles.nameLine}>
      <AgentIcon kind={id} />
      <span className={styles.agentName}>{AGENT_SPECS[id].label}</span>
    </span>
  )
}
