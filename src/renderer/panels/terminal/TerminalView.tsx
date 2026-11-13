// 终端 view (PRD F17, Figma 76A / 76B): plain shells in the active session's worktree, one tab each. Every session of
// the worktree shares its tabs (RightPanel keys this view by worktree). The shells are no workspace sessions: no
// sidebar row, no status, no notifications.
import { Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SessionId, Worktree } from '@shared/types'
import { getSurface, getXtermSurface, setTerminalShown } from '../../terminal/registry'
import { terminalHostClass, useTerminalHost } from '../../terminal/TerminalArea'
import { IconButton } from '../../ui/IconButton'
import { PaneHeader } from '../PaneHeader'
import { closeTab, openTab, openWorktreeTabs } from './actions'
import { selectTab, usePanelTerminals } from './store'
import styles from './TerminalView.module.css'

export function TerminalView({ worktree }: { worktree: Worktree }) {
  const { id: worktreeId, path } = worktree
  const ids = usePanelTerminals((s) => s.worktrees[worktreeId]?.ids)
  const active = usePanelTerminals((s) => s.worktrees[worktreeId]?.active ?? null)
  const titles = usePanelTerminals((s) => s.titles)
  // The tab the user just picked or opened takes the keyboard; the one shown when the view opens does not.
  const [focusId, setFocusId] = useState<SessionId | null>(null)

  useEffect(() => {
    let cancelled = false
    void openWorktreeTabs({ id: worktreeId, path }, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [worktreeId, path])

  const pick = (id: SessionId): void => {
    selectTab(id)
    setFocusId(id)
  }

  return (
    <>
      <PaneHeader title="终端" context={worktree.branch}>
        <IconButton label="新建终端" onClick={() => setFocusId(openTab({ id: worktreeId, path }))}>
          <Plus size={16} strokeWidth={1.75} />
        </IconButton>
      </PaneHeader>
      {ids && ids.length > 1 && (
        <div className={styles.tabs} role="tablist" aria-label="终端">
          {ids.map((id) => (
            <div key={id} className={styles.tab} data-active={id === active}>
              <button type="button" role="tab" aria-selected={id === active} className={styles.label} onClick={() => pick(id)}>
                {titles[id] ?? window.tr.shellName}
              </button>
              <button type="button" className={styles.close} aria-label="关闭终端" title="关闭终端" onClick={() => closeTab(id)}>
                <X size={12} strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className={styles.body} data-testid="panel-terminal">
        {ids?.map((id) => <TabTerminal key={id} id={id} cwd={path} shown={id === active} focus={id === focusId} />)}
      </div>
    </>
  )
}

/** One tab's terminal: created the first time it is shown, then kept (hidden) while another tab is. */
function TabTerminal({ id, cwd, shown, focus }: { id: SessionId; cwd: string; shown: boolean; focus: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [everActive, setEverActive] = useState(shown)
  if (shown && !everActive) setEverActive(true)
  useTerminalHost(id, hostRef, null, { everActive, held: false, shown, cwd, agent: 'shell', resumeAgentSessionId: undefined, generation: 0 })

  useEffect(() => {
    if (!focus || !shown) return
    const surface = getXtermSurface(id)
    // xterm ignores focus() until it is open (fonts loaded, attached to the DOM).
    void surface?.whenOpen().then(() => surface.focus())
  }, [focus, shown, id])

  // The view goes away (another view, the panel closed, another worktree) and its xterm with the host: the shell keeps
  // running, hidden, and gives its WebGL context back.
  useEffect(
    () => () => {
      getXtermSurface(id)?.setVisible(false)
      setTerminalShown(id, false)
    },
    [id]
  )

  return (
    <div
      ref={hostRef}
      className={`${terminalHostClass} ${styles.host}`}
      data-shown={shown}
      data-terminal-id={id}
      onClick={() => getSurface(id)?.focus()}
    />
  )
}
