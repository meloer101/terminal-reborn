// Right panel (PRD F17, Figma 13): a floating card beside the terminal. The session header's icons pick the view;
// the content always follows the active session's worktree. Browser, Git and Worktree land in later milestones.
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useActiveSession, useWorkspace, type PanelView } from '../state/workspace'
import { PANEL_WIDTH_DEFAULT } from '@shared/workspace-file'
import { FilesView } from './files/FilesView'
import { PaneHeader } from './PaneHeader'
import styles from './RightPanel.module.css'

export const PANEL_VIEW_LABEL: Record<PanelView, string> = { browser: '浏览器', git: 'Git', worktree: 'Worktree', files: '文件' }

export function RightPanel({ view }: { view: PanelView }) {
  const active = useActiveSession()
  const projectName = useWorkspace((s) => s.projects.find((p) => p.id === active?.worktree?.projectId)?.name ?? '')
  const worktree = active?.worktree
  return (
    <>
      <ResizeHandle />
      <div className={styles.card} data-view={view} data-testid="right-panel">
        {view === 'files' && worktree && active ? (
          <FilesView key={worktree.path} root={worktree.path} sessionId={active.session.id} />
        ) : (
          <>
            <PaneHeader title={PANEL_VIEW_LABEL[view]} context={view === 'browser' ? '' : projectName} />
            <p className={styles.placeholder}>
              {worktree ? `${PANEL_VIEW_LABEL[view]} 视图还在开发中` : '选中一个会话后，这里显示它所在的 worktree'}
            </p>
          </>
        )}
      </div>
    </>
  )
}

/** The card's left edge: drag to resize (min 400, saved), double-click for the default width. */
function ResizeHandle() {
  const setWidth = useWorkspace((s) => s.setRightPanelWidth)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    // The card is anchored on the right: moving the edge left by n px makes it n px wider.
    const startX = e.clientX
    const startWidth = useWorkspace.getState().rightPanelWidth
    const move = (event: PointerEvent) => setWidth(startWidth + startX - event.clientX)
    // The release point counts too: Chromium can drop the last rAF-aligned move before pointerup.
    const up = (event: PointerEvent) => {
      move(event)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }
  return (
    <div
      className={styles.resize}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整右侧栏宽度"
      onPointerDown={onPointerDown}
      onDoubleClick={() => setWidth(PANEL_WIDTH_DEFAULT)}
    />
  )
}
