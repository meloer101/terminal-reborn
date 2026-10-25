// Welcome page: the main area when no session is selected (PRD F18 · Figma 14). A greeting, one short line and one
// next step. The sidebar already carries navigation and projects, so nothing here repeats it; the agent install
// block appears only when neither supported agent is installed.
import { useEffect, useState, type DragEvent } from 'react'
import { Copy } from 'lucide-react'
import type { AgentAvailability } from '@shared/ipc'
import type { AgentKind } from '@shared/types'
import { SHORTCUTS } from '@shared/shortcuts'
import { openProjectInteractive, openProjectPath } from '../state/session-actions'
import { useWorkspace } from '../state/workspace'
import { IconButton } from '../ui/IconButton'
import { Segmented } from '../ui/Segmented'
import { StatusGlyph } from '../ui/StatusGlyph'
import { formatAccelerator } from '../ui/menu-model'
import { defaultAgent, greeting, INSTALLABLE_AGENTS, needsAgentInstall, pickQuote } from './empty-main'
import styles from './EmptyMain.module.css'

/** Picked once per launch, so the line does not change every time the page reappears. */
const QUOTE = pickQuote()

const HINTS = [
  [SHORTCUTS['command-palette'], '跳转到'],
  [SHORTCUTS['toggle-overview'], '总览'],
  [SHORTCUTS['next-attention'], '下一个等你处理'],
  [SHORTCUTS['open-project'], '打开项目']
] as const

function useAgentAvailability(): AgentAvailability | null {
  const [agents, setAgents] = useState<AgentAvailability | null>(null)
  useEffect(() => {
    let live = true
    window.tr.app
      .detectAgents()
      .then((result) => live && setAgents(result))
      .catch(() => live && setAgents({}))
    return () => {
      live = false
    }
  }, [])
  return agents
}

function useUserName(): string {
  const [name, setName] = useState('')
  useEffect(() => {
    let live = true
    window.tr.app
      .userName()
      .then((result) => live && setName(result))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return name
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

function InstallAgent() {
  const [selected, setSelected] = useState(INSTALLABLE_AGENTS[0]!)
  return (
    <section className={styles.install} aria-label="安装 agent" data-testid="install-agent">
      <p className={styles.installMessage}>
        <StatusGlyph status="needs_you" />
        还没有装任何 agent，选一个装上：
      </p>
      <Segmented
        label="选择 agent"
        variant="plain"
        className={styles.picker}
        value={selected.id}
        options={INSTALLABLE_AGENTS.map((agent) => ({ value: agent.id, label: agent.name }))}
        onChange={(id) => setSelected(INSTALLABLE_AGENTS.find((agent) => agent.id === id) ?? selected)}
      />
      <div className={styles.command}>
        <code>{selected.command}</code>
        <IconButton label={`复制 ${selected.name} 安装命令`} onClick={() => void navigator.clipboard.writeText(selected.command).catch(() => {})}>
          <Copy size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
    </section>
  )
}

export function EmptyMain() {
  const hasProjects = useWorkspace((s) => s.projects.length > 0)
  const agents = useAgentAvailability()
  const name = useUserName()
  const [dragging, setDragging] = useState(false)

  // New sessions start the installed agent: Claude Code, else Codex.
  const kind: AgentKind = defaultAgent(agents)

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
      <div className={styles.welcome}>
        <h2 className={styles.greeting}>
          <span className={styles.mark} aria-hidden />
          {greeting(new Date().getHours(), name)}
        </h2>
        <p className={styles.quote}>
          {dragging ? (
            <span className={styles.dropLine}>松开就打开这个文件夹</span>
          ) : (
            <>
              {QUOTE.text}
              {QUOTE.by && <span className={styles.by}>— {QUOTE.by}</span>}
            </>
          )}
        </p>

        {hasProjects ? (
          <ul className={styles.hints} aria-label="快捷键">
            {HINTS.map(([accelerator, label]) => (
              <li key={label}>
                <kbd className={styles.key}>{formatAccelerator(accelerator)}</kbd>
                {label}
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.next}>
            <button type="button" className={styles.open} onClick={() => void openProjectInteractive(kind)}>
              打开项目…<kbd className={styles.kbd}>{formatAccelerator(SHORTCUTS['open-project'])}</kbd>
            </button>
            <span className={styles.dropHint}>或把文件夹拖进窗口</span>
          </div>
        )}

        {needsAgentInstall(agents) && <InstallAgent />}
      </div>
    </div>
  )
}
