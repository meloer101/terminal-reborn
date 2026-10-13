// PLACEHOLDER — changes panel lands in M4 (F5), graph panel in M5 (F6).
import type { RightPanelTab } from '../state/workspace'
import { useWorkspace } from '../state/workspace'
import styles from './RightPanel.module.css'

const TABS: { id: RightPanelTab; label: string }[] = [
  { id: 'changes', label: '变更' },
  { id: 'graph', label: '图谱' }
]

export function RightPanel({ tab }: { tab: RightPanelTab }) {
  const setRightPanel = useWorkspace((s) => s.setRightPanel)
  return (
    <div className={styles.tabs} role="tablist">
      {TABS.map((t) => (
        <button
          type="button"
          role="tab"
          key={t.id}
          aria-selected={t.id === tab}
          className={styles.tab}
          onClick={() => setRightPanel(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
