// The sidebar as a drawer (PRD §5 玻璃外壳 · 动效): used by the main window and by secondary windows.
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { SIDEBAR_WIDTH_DEFAULT } from '@shared/workspace-file'
import { useWorkspace } from '../state/workspace'
import { Sidebar } from '../sidebar/Sidebar'
import { startColumnResize } from '../ui/column-resize'
import { drawerIsWide, useDrawer } from './drawer-motion'
import styles from './AppShell.module.css'

/**
 * The sidebar as a drawer: its width springs between 0 and the user's while its content (always full width) slides
 * in from the left edge. Stays mounted through the closing motion; inert while it closes.
 */
export function SidebarDrawer({ collapsed, width, resizable = false }: { collapsed: boolean; width: number; resizable?: boolean }) {
  const ref = useRef<HTMLElement>(null)
  const drawer = useDrawer(collapsed ? null : true, ref)
  if (!drawer.shown) return null
  return (
    <aside
      ref={ref}
      className={styles.sidebar}
      data-region="sidebar"
      data-phase={drawer.phase}
      inert={drawer.phase === 'closing'}
      style={{ width: drawerIsWide(drawer.phase) ? `${width}px` : 0 }}
    >
      <div className={styles.sidebarInner} style={{ width: `${width}px` }}>
        <Sidebar />
      </div>
      {resizable && drawer.phase === 'open' && <SidebarResizeHandle width={width} />}
    </aside>
  )
}

/** The sidebar's right edge: drag to resize (200–480, saved), double-click for 264. */
function SidebarResizeHandle({ width }: { width: number }) {
  const setWidth = useWorkspace((s) => s.setSidebarWidth)
  // Starts from the width as shown, which can be narrower than the saved one in a small window (layout.ts).
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => startColumnResize(e, 'right', width, setWidth)
  return (
    <div
      className={styles.sidebarResize}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧栏宽度"
      onPointerDown={onPointerDown}
      onDoubleClick={() => setWidth(SIDEBAR_WIDTH_DEFAULT)}
    />
  )
}
