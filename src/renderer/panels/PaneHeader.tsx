// Top row of every right panel view (Figma 13 "Pane header"): title · context · a few icons · ×.
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useWorkspace } from '../state/workspace'
import { SHORTCUTS } from '@shared/shortcuts'
import { IconButton } from '../ui/IconButton'
import { formatAccelerator } from '../ui/menu-model'
import styles from './RightPanel.module.css'

/** Card top row (40 high): title · context in tertiary mono · a few icons · ×. */
export function PaneHeader({ title, context, children }: { title: string; context?: string; children?: ReactNode }) {
  return (
    <div className={styles.header}>
      <h2 className={styles.title}>{title}</h2>
      <span className={styles.context}>{context}</span>
      <span className={styles.actions}>
        {children}
        <ClosePanelButton />
      </span>
    </div>
  )
}

export function ClosePanelButton() {
  const setRightPanel = useWorkspace((s) => s.setRightPanel)
  return (
    <IconButton label="关闭右侧栏" title={`关闭右侧栏 · ${formatAccelerator(SHORTCUTS['toggle-right-panel'])}`} onClick={() => setRightPanel(null)}>
      <X size={16} strokeWidth={1.75} />
    </IconButton>
  )
}

