// Settings content (Figma 07 · 设置 · 外观), shown inside SettingsDialog over the main window.
import { useRef, type KeyboardEvent } from 'react'
import { Bot, Gauge, GitBranch, Type, Workflow, X, type LucideIcon } from 'lucide-react'
import { create } from 'zustand'
import { IconButton } from '../ui/IconButton'
import { AgentsPane } from './AgentsPane'
import { AppearancePane } from './AppearancePane'
import { AutomationPane } from './AutomationPane'
import { UsagePane } from './UsagePane'
import { useSettings } from './useSettings'
import { WorktreePane } from './WorktreePane'
import styles from './SettingsApp.module.css'

// 通用 / 终端 / Agent / 快捷键 come back with their content; an empty "即将推出" pane is a dead end (B11). The version and
// 检查更新 moved from 关于 to the sidebar's 更新 (Figma 36G, PRD v1.93).
export type SettingsPaneId = 'appearance' | 'agents' | 'usage' | 'worktree' | 'automation'
type PaneId = SettingsPaneId

/** The pane on show; openSettings('usage') (the sidebar's 额度, ⇧⌘U) sets it. */
export const useSettingsPane = create<{ pane: PaneId }>()(() => ({ pane: 'appearance' }))
const setPane = (pane: PaneId) => useSettingsPane.setState({ pane })

const NAV: ReadonlyArray<{ id: PaneId; label: string; Icon: LucideIcon }> = [
  { id: 'appearance', label: '外观', Icon: Type },
  { id: 'agents', label: '智能体', Icon: Bot },
  { id: 'usage', label: '额度', Icon: Gauge },
  { id: 'worktree', label: 'Worktree', Icon: GitBranch },
  { id: 'automation', label: '自动化', Icon: Workflow }
]

export function SettingsApp({ onClose }: { onClose(): void }) {
  const { settings, loaded, updateAppearance, updatePorts, updateReview, updateArchive, updateAlerts, updatePr, updateDispatch } = useSettings()
  const pane = useSettingsPane((s) => s.pane)
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
            pr={settings.pr}
            updatePr={updatePr}
            dispatch={settings.dispatch}
            updateDispatch={updateDispatch}
          />
        )}
        {pane === 'agents' && <AgentsPane />}
        {pane === 'usage' && <UsagePane alerts={loaded ? settings.alerts : null} updateAlerts={updateAlerts} />}
      </main>
    </div>
  )
}
