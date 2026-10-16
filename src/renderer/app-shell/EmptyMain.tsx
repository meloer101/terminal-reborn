// Main area without a session (phase 2b · B10): first run, or every session closed. One clear next step —
// open a project — plus recent folders, which agent CLIs are installed, and folder drop. No Figma screen yet;
// built from the sidebar's empty state (Figma 09 · A) vocabulary: quiet text, hairlines, one bordered action.
import { useEffect, useState, type DragEvent } from 'react'
import { Copy, FolderOpen } from 'lucide-react'
import type { AgentAvailability } from '@shared/ipc'
import type { AgentKind } from '@shared/types'
import { INSTALL_HINT } from '../lifecycle/present'
import { openProjectInteractive, openProjectPath } from '../state/session-actions'
import { useWorkspace } from '../state/workspace'
import { IconButton } from '../ui/IconButton'
import { recentFolders, tildePath } from './empty-main'
import styles from './EmptyMain.module.css'

const AGENTS: { kind: Exclude<AgentKind, 'shell'>; name: string }[] = [
  { kind: 'claude', name: 'Claude Code' },
  { kind: 'codex', name: 'Codex' }
]

function useAgentAvailability(): AgentAvailability | null {
  const [agents, setAgents] = useState<AgentAvailability | null>(null)
  useEffect(() => {
    let live = true
    window.tr.app
      .detectAgents()
      .then((result) => live && setAgents(result))
      .catch(() => live && setAgents({ claude: false, codex: false }))
    return () => {
      live = false
    }
  }, [])
  return agents
}

/** The folder in a drop, if the first dropped item is one. */
function droppedFolder(e: DragEvent): string | null {
  const item = Array.from(e.dataTransfer.items).find((i) => i.kind === 'file')
  const entry = item?.webkitGetAsEntry()
  const file = item?.getAsFile()
  if (!entry?.isDirectory || !file) return null
  const path = window.tr.files.pathForFile(file)
  return path.length > 0 ? path : null
}

export function EmptyMain() {
  const projects = useWorkspace((s) => s.projects)
  const recent = useWorkspace((s) => s.recentProjects)
  const agents = useAgentAvailability()
  const [dragging, setDragging] = useState(false)

  // New sessions start the installed agent: Claude Code, else Codex.
  const kind: AgentKind = agents && !agents.claude && agents.codex ? 'codex' : 'claude'
  const folders = recentFolders(recent, projects)

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDragging(false)
    const path = droppedFolder(e)
    if (path) openProjectPath(path, kind)
  }

  return (
    <div
      className={styles.empty}
      data-testid="empty-main"
      data-dragging={dragging}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className={styles.column}>
        <h2 className={styles.title}>打开一个项目开始</h2>
        <p className={styles.lead}>选择一个代码仓库或文件夹，在里面运行 Claude Code、Codex 或终端。</p>
        <button type="button" className={styles.primary} onClick={() => void openProjectInteractive(kind)}>
          <FolderOpen size={16} strokeWidth={1.75} aria-hidden />
          <span>打开项目…</span>
          <kbd className={styles.kbd}>⌘O</kbd>
        </button>

        {folders.length > 0 && (
          <section className={styles.section} aria-labelledby="empty-recent">
            <h3 className={styles.heading} id="empty-recent">
              最近项目
            </h3>
            <ul className={styles.list}>
              {folders.map((f) => (
                <li key={f.path}>
                  <button type="button" className={styles.row} title={f.path} onClick={() => openProjectPath(f.path, kind)}>
                    <span className={styles.name}>{f.name}</span>
                    <span className={styles.path}>{tildePath(f.path, window.tr.homeDir)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={styles.section} aria-labelledby="empty-agents">
          <h3 className={styles.heading} id="empty-agents">
            智能体
          </h3>
          <ul className={styles.list}>
            {AGENTS.map(({ kind: agent, name }) => (
              <li key={agent} className={styles.agent} data-agent={agent} data-installed={agents ? agents[agent] : undefined}>
                <span className={styles.name}>{name}</span>
                {agents === null ? (
                  <span className={styles.state}>检测中…</span>
                ) : agents[agent] ? (
                  <span className={styles.state}>已安装</span>
                ) : (
                  <>
                    <span className={styles.state}>未安装</span>
                    <code className={styles.command}>{INSTALL_HINT[agent]}</code>
                    <IconButton label={`复制 ${name} 安装命令`} onClick={() => void navigator.clipboard.writeText(INSTALL_HINT[agent]).catch(() => {})}>
                      <Copy size={16} strokeWidth={1.75} />
                    </IconButton>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>

        <p className={styles.hint}>也可以把文件夹拖到这里打开。</p>
      </div>
    </div>
  )
}
