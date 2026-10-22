// Settings content (Figma 07 · 设置 · 外观), shown inside SettingsDialog over the main window.
import { useRef, useState, type KeyboardEvent } from 'react'
import { GitBranch, Info, Type, Workflow, X, type LucideIcon } from 'lucide-react'
import { IconButton } from '../ui/IconButton'
import { AboutPane } from './AboutPane'
import { AppearancePane } from './AppearancePane'
import { AutomationPane } from './AutomationPane'
import { useSettings } from './useSettings'
import { WorktreePane } from './WorktreePane'
import styles from './SettingsApp.module.css'

// 通用 / 终端 / Agent / 快捷键 come back with their content; an empty "即将推出" pane is a dead end (B11).
type PaneId = 'appearance' | 'worktree' | 'automation' | 'about'

const NAV: ReadonlyArray<{ id: PaneId; label: string; Icon: LucideIcon }> = [
  { id: 'appearance', label: '外观', Icon: Type },
  { id: 'worktree', label: 'Worktree', Icon: GitBranch },
  { id: 'automation', label: '自动化', Icon: Workflow },
  { id: 'about', label: '关于', Icon: Info }
]

export function SettingsApp({ onClose }: { onClose(): void }) {
  const { settings, loaded, updateAppearance, updatePorts, updateReview, updateArchive, updateAlerts, updatePr, updateDispatch } = useSettings()
  const [pane, setPane] = useState<PaneId>('appearance')
  const items = useRef(new Map<PaneId, HTMLButtonElement>())

  const onNavKeyDown = (event: KeyboardEvent): void => {
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (delta === 0) return
    event.preventDefault()
    const index = NAV.findIndex((item) => item.id === pane)
    const next = NAV[(index + delta + NAV.length) % NAV.length]
    if (!next) return
    setPane(next.id)
    items.current.get(next.id)?.focus()
  }

  return (
    <div className={styles.window}>
      <nav className={styles.nav} aria-label="设置">
        <h1 className={styles.title}>设置</h1>
        <div className={styles.items} role="tablist" aria-orientation="vertical" onKeyDown={onNavKeyDown}>
          {NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              ref={(node) => {
                if (node) items.current.set(id, node)
                else items.current.delete(id)
              }}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={pane === id}
              aria-controls="settings-pane"
              tabIndex={pane === id ? 0 : -1}
              className={styles.item}
              onClick={() => setPane(id)}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>
      <main className={styles.content} id="settings-pane" role="tabpanel" aria-labelledby={`tab-${pane}`} data-loaded={loaded}>
        <div className={styles.closeBar}>
          <IconButton label="关闭设置（Esc）" onClick={onClose}>
            <X size={16} strokeWidth={1.75} />
          </IconButton>
        </div>
        {pane === 'appearance' && loaded && <AppearancePane appearance={settings.appearance} update={updateAppearance} />}
        {pane === 'worktree' && loaded && <WorktreePane
            base={settings.ports.base}
            update={(base) => updatePorts({ base })}
            archiveAfterMerge={settings.archive.afterMerge}
            updateArchiveAfterMerge={(afterMerge) => updateArchive({ afterMerge })}
          />}
        {pane === 'automation' && loaded && (
          <AutomationPane
            review={settings.review}
            update={updateReview}
            alerts={settings.alerts}
            updateAlerts={updateAlerts}
            pr={settings.pr}
            updatePr={updatePr}
            dispatch={settings.dispatch}
            updateDispatch={updateDispatch}
          />
        )}
        {pane === 'about' && <AboutPane />}
      </main>
    </div>
  )
}
