// Right panel (PRD F17, Figma 13 / 28G): a card beside the terminal, at the same level. Above it, on the window's glass,
// the active session's tools stay where they are when the panel is closed (the session header's tools part); their
// icons pick the view. The content always follows the active session's worktree.
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useActiveSession, useWorkspace, type PanelView } from '../state/workspace'
import { PANEL_WIDTH_DEFAULT } from '@shared/workspace-file'
import { BrowserView } from './browser/BrowserView'
import { FilesView } from './files/FilesView'
import { GitView } from './git/GitView'
import { WorktreeView } from './worktree/WorktreeView'
import { PaneHeader } from './PaneHeader'
import { SessionHeader } from '../session-header/SessionHeader'
import { startColumnResize } from '../ui/column-resize'
import styles from './RightPanel.module.css'

export const PANEL_VIEW_LABEL: Record<PanelView, string> = { browser: '浏览器', git: 'Git', worktree: 'Worktree', files: '文件' }

export function RightPanel({ view }: { view: PanelView }) {
  const active = useActiveSession()
  const project = useWorkspace((s) => s.projects.find((p) => p.id === active?.worktree?.projectId))
  const projectName = project?.name ?? ''
  const worktree = active?.worktree
  return (
    <>
      <ResizeHandle />
      <SessionHeader part="tools" />
      <div className={styles.card} data-view={view} data-testid="right-panel">
        {view === 'files' && worktree && active ? (
          <FilesView key={worktree.path} root={worktree.path} sessionId={active.session.id} />
        ) : view === 'git' && worktree ? (
          <GitView key={worktree.path} worktree={worktree} />
        ) : view === 'worktree' && worktree && project ? (
          <WorktreeView key={project.rootPath} projectId={project.id} root={project.rootPath} projectName={project.name} activeWorktreeId={worktree.id} />
        ) : view === 'browser' && worktree && active ? (
          <BrowserView key={worktree.path} worktree={worktree.path} sessionId={active.session.id} kind={active.session.kind} />
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
  // The card is anchored on the right: moving the edge left by n px makes it n px wider. Starts from the width as
  // shown, which can be narrower than the saved one in a small window (app-shell/layout.ts).
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const card = e.currentTarget.parentElement?.querySelector('[data-testid="right-panel"]')
    const shown = card instanceof HTMLElement ? Math.round(card.getBoundingClientRect().width) : useWorkspace.getState().rightPanelWidth
    startColumnResize(e, 'left', shown, setWidth)
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
