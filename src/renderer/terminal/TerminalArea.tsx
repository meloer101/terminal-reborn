// One xterm-backed terminal per session. Terminals are created the first time a session is
// viewed and then stay mounted (display:none) so scrollback and running programs survive
// switching sessions. The main area places the shown ones (PRD F20: one per pane of a split); moving between
// panes only moves the element, never the terminal. A secondary window's panes (F20 · 多窗口) borrow the terminal into
// that window's document (PaneHosts): the same xterm, the same PTY stream, only its DOM moves.
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Rect } from '@shared/split-layout'
import { useShallow } from 'zustand/react/shallow'
import type { AgentKind, SessionId, Worktree } from '@shared/types'
import { useEagerStarts, useWorktreeCreations } from '../new-session/creation'
import { runSessionWaits, useRunScripts } from '../scripts/run-script'
import { useSessionStartup, useStartRequests } from '../state/session-start'
import { launchKind, useWorkspace } from '../state/workspace'
import { windowOf } from '../app-shell/windows-runtime'
import { onTerminalFitReleased, terminalFitHeld } from '../app-shell/drawer-motion'
import { useIsKeyWindow, useWindowScope } from '../state/window-scope'
import { borrowTerminal, useBorrowedTerminal } from './borrow'
import { useLiveSessions } from './live-sessions'
import { ensureTerminal, getSurface, getXtermSurface, pruneTerminals, resyncTerminal, setTerminalShown } from './registry'
import { attachFileInput } from './file-input'
import { closeTerminalSearch } from './search-store'
import { TerminalSearch } from './TerminalSearch'
import styles from './TerminalArea.module.css'

interface PaneProps {
  sessionId: SessionId
  cwd: string
  agent: AgentKind
  /** The keyboard's pane. */
  active: boolean
  /** Where it is shown in the terminal area; undefined = not shown. */
  rect: Rect | undefined
  /** Restored from disk and not started yet: no terminal until startSession() (state/session-start.ts). */
  held: boolean
  /** Its process kept running in the pty daemon: attach now, viewed or not (status and notifications need it). */
  live: boolean
  /** Earlier conversation to continue; `generation` changes whenever the session is started again. */
  resumeAgentSessionId: string | undefined
  generation: number
}

const place = (rect: Rect | undefined): CSSProperties | undefined =>
  rect && { left: rect.x, top: rect.y, width: rect.width, height: rect.height }

const TerminalPane = memo(function TerminalPane({ sessionId, cwd, agent, active, rect, held, live, resumeAgentSessionId, generation }: PaneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  // The overview may show this terminal in its own host for a while (borrow.ts).
  const borrowedHost = useBorrowedTerminal((s) => s.hosts[sessionId] ?? null)
  const placed = rect !== undefined
  const shown = placed || borrowedHost !== null
  // Spawn lazily: nothing is created until the session has been shown once (a live process is attached at once).
  const [everActive, setEverActive] = useState(placed || live)
  if ((shown || live) && !everActive) setEverActive(true)

  useEffect(() => {
    const host = borrowedHost ?? hostRef.current
    if (!everActive || held || !host) return
    ensureTerminal(sessionId, cwd, agent, resumeAgentSessionId).attach(host)
    // First mount and a borrow both finish here, once the node is in `host`. Show it in this task,
    // not on a frame: xterm redraws on a rAF, and a rAF queued from inside a rAF waits a frame, so
    // the frame that reloads WebGL paints an empty canvas. A hidden main window still runs this
    // task; it does not need the borrowed window to produce a frame. Session switches do not
    // re-run this effect. The layout effect below shows a terminal that is already in its host.
    if (host.offsetParent !== null) getXtermSurface(sessionId)?.setVisible(true)
  }, [everActive, held, sessionId, cwd, agent, resumeAgentSessionId, generation, borrowedHost])

  // A hidden terminal's process gets far less output in flight, so a shown one's echo never queues behind it. After
  // the attach effect above, which creates the terminal in the same commit; `generation` too, because a restart
  // (startSession) disposes the terminal and the new one starts out shown.
  useEffect(() => {
    if (everActive && !held) setTerminalShown(sessionId, shown)
  }, [shown, everActive, held, sessionId, generation])

  // Files dropped on or pasted into the terminal (PRD F19), wherever it is shown.
  useEffect(() => {
    const host = borrowedHost ?? hostRef.current
    if (!everActive || held || !host) return
    return attachFileInput(host, sessionId)
  }, [everActive, held, sessionId, borrowedHost])

  // Hidden terminals give the WebGL context back (browsers cap live contexts).
  useEffect(() => {
    if (!everActive || shown) return
    getXtermSurface(sessionId)?.setVisible(false)
  }, [shown, everActive, sessionId])

  // Showing has to happen before paint. Doing it on a rAF clears the canvas for the frame the pane
  // is already visible, because xterm's redraw is itself a rAF and does not run until the next one.
  useLayoutEffect(() => {
    if (!everActive || !shown) return
    const host = borrowedHost ?? hostRef.current
    // A borrow moves the node in the attach effect, after this layout pass, so the xterm is still
    // in the previous host. That effect shows it once the move is done.
    if (!host?.querySelector('.xterm')) return
    getXtermSurface(sessionId)?.setVisible(true)
  }, [shown, everActive, sessionId, borrowedHost])

  useEffect(() => {
    const host = borrowedHost ?? hostRef.current
    if (!everActive || !host) return
    let frame = 0
    // An observer of the host's own window: one from another window never sees its layout change.
    const win = hostWindow(host)
    const refit = (): void => {
      win.cancelAnimationFrame(frame)
      frame = win.requestAnimationFrame(() => {
        if (host.offsetParent !== null) getSurface(sessionId)?.fit()
      })
    }
    // While the sidebar or the right panel slides, the grid stays put and refits once at the end (app-shell/drawer-motion).
    const observer = new win.ResizeObserver(() => {
      if (!terminalFitHeld()) refit()
    })
    observer.observe(host)
    // The release is a timer task, not a frame callback. Fitting here lets xterm's redraw rAF run
    // before the next paint; fitting inside refit's rAF would clear the canvas for one frame.
    const offReleased = onTerminalFitReleased(() => {
      win.cancelAnimationFrame(frame)
      frame = 0
      if (host.offsetParent !== null) getSurface(sessionId)?.fit()
    })
    return () => {
      win.cancelAnimationFrame(frame)
      observer.disconnect()
      offReleased()
    }
  }, [everActive, sessionId, borrowedHost])

  return (
    <div
      className={styles.pane}
      data-active={active}
      data-shown={placed}
      data-session-id={sessionId}
      style={place(rect)}
      onClick={() => getSurface(sessionId)?.focus()}
      // The keyboard went into this pane's terminal (a click): its session becomes the active one (PRD F20).
      onFocus={() => useWorkspace.getState().focusPane(sessionId)}
    >
      <div ref={hostRef} className={styles.host} />
    </div>
  )
}, samePaneProps)

/**
 * Every pane re-renders with TerminalArea, which reads the whole session list (any session's hook event changes it);
 * a pane only needs to when its own props do. `rect` is rebuilt with each layout, so it is compared by value.
 */
function samePaneProps(a: PaneProps, b: PaneProps): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.cwd === b.cwd &&
    a.agent === b.agent &&
    a.active === b.active &&
    a.held === b.held &&
    a.live === b.live &&
    a.resumeAgentSessionId === b.resumeAgentSessionId &&
    a.generation === b.generation &&
    a.rect?.x === b.rect?.x &&
    a.rect?.y === b.rect?.y &&
    a.rect?.width === b.rect?.width &&
    a.rect?.height === b.rect?.height
  )
}

/** The window an element is in (the main window for none). */
const hostWindow = (node: Node | null | undefined): Window & typeof globalThis =>
  (node?.ownerDocument?.defaultView as (Window & typeof globalThis) | null | undefined) ?? window

/** Whether moving the keyboard focus now (in `doc`, the terminal's window) would take it from something the user is typing in. */
function canStealFocus(doc: Document): boolean {
  if (doc.querySelector('[role="dialog"][aria-modal="true"]')) return false
  const active = doc.activeElement
  if (!active || active === doc.body) return true
  // By tag, not instanceof: a secondary window's elements come from that window's constructors.
  const typing = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable
  return !typing || active.matches('.xterm-helper-textarea')
}

/** How long to wait for a terminal to exist: a restored agent spawns only after the daemon listing (~10 s at 60 fps). */
const FOCUS_WAIT_FRAMES = 600

/**
 * The keyboard follows the active session into its terminal (B7) — on every selection or explicit request
 * (`focusRequest`), not only when the active id changes. The terminal can appear frames or seconds later.
 */
function useFocusActiveTerminal(sessionId: SessionId | null, request: number): void {
  useEffect(() => {
    if (!sessionId) return
    let frame = 0
    let tries = 0
    let cancelled = false
    // Frames of the window with the keyboard (F20 · 多窗口): a hidden main window draws none.
    const win = windowOf(useWorkspace.getState().keyWindow) ?? window
    const attempt = (): void => {
      const surface = getXtermSurface(sessionId)
      if (!surface) {
        if (tries++ < FOCUS_WAIT_FRAMES) frame = win.requestAnimationFrame(attempt)
        return
      }
      // xterm ignores focus() until it is open (fonts loaded, attached to the DOM).
      void surface.whenOpen().then(() => {
        if (!cancelled && canStealFocus(surface.ownerDocument())) surface.focus()
      })
    }
    // Never within the event that asked: the keypress / keyup of an ↵ that picked the session must not reach xterm.
    frame = win.requestAnimationFrame(attempt)
    return () => {
      cancelled = true
      win.cancelAnimationFrame(frame)
    }
  }, [sessionId, request])
}

/**
 * Waking from sleep, refocusing the window or moving it to a screen with another pixel ratio can leave the
 * visible terminals with stale glyphs or a grid the PTY does not know about: redraw them and resend their size.
 * `shown` is the shown sessions' ids, one per line (every pane of a split).
 */
function useResyncOnWake(shown: string, win: Window = window): void {
  useEffect(() => {
    if (!shown) return
    const doc = win.document
    let frame = 0
    const resync = (): void => {
      win.cancelAnimationFrame(frame)
      frame = win.requestAnimationFrame(() => {
        for (const sessionId of shown.split('\n')) resyncTerminal(sessionId)
      })
    }
    const onVisibility = (): void => {
      if (doc.visibilityState === 'visible') resync()
    }
    let ratio: MediaQueryList | null = null
    const watchRatio = (): void => {
      ratio?.removeEventListener('change', onRatio)
      ratio = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`)
      ratio.addEventListener('change', onRatio)
    }
    function onRatio(): void {
      watchRatio()
      resync()
    }
    watchRatio()
    win.addEventListener('focus', resync)
    doc.addEventListener('visibilitychange', onVisibility)
    return () => {
      win.cancelAnimationFrame(frame)
      ratio?.removeEventListener('change', onRatio)
      win.removeEventListener('focus', resync)
      doc.removeEventListener('visibilitychange', onVisibility)
    }
  }, [shown, win])
}

/** `placements`: where each shown session's terminal goes (below its pane's header). */
export function TerminalArea({ placements }: { placements: Readonly<Record<SessionId, Rect>> }) {
  const { sessions, worktrees, activeSessionId } = useWorkspace(
    useShallow((s) => ({ sessions: s.sessions, worktrees: s.worktrees, activeSessionId: s.activeSessionId }))
  )

  const requests = useStartRequests((s) => s.requests)
  const live = useLiveSessions((s) => s.live)
  // A session whose new worktree is still being created (or failed) has no folder to start in yet (PRD F4).
  const waitingForWorktree = useWorktreeCreations((s) => s.held)
  // 一题多解: every member starts at once, shown or not, so its prompt can be sent.
  const eager = useEagerStarts((s) => s.ids)
  // The Run button's terminal starts its script only when the button is pressed (PRD F4).
  const runStarts = useRunScripts((s) => s.started)
  useSessionStartup()
  const focusRequest = useWorkspace((s) => s.focusRequest)
  useFocusActiveTerminal(activeSessionId, focusRequest)
  useResyncOnWake(Object.keys(placements).join('\n'))

  useEffect(() => {
    // Every record, archived ones included: their saved screens stay for the restore.
    pruneTerminals(new Set(sessions.map((s) => s.id)))
  }, [sessions])

  // A find belongs to one terminal's buffer.
  useEffect(() => closeTerminalSearch(), [activeSessionId])

  return (
    <div className={styles.area} data-region="terminal">
      {/* An archived worktree's panes unmount (PRD F15); restoring mounts them again, which starts them afresh. */}
      {sessions.filter((session) => !archivedWorktree(worktrees, session.worktreeId)).map((session) => (
        <TerminalPane
          key={session.id}
          sessionId={session.id}
          cwd={worktrees.find((w) => w.id === session.worktreeId)?.path ?? window.tr.homeDir}
          agent={launchKind(session)}
          active={session.id === activeSessionId}
          rect={placements[session.id]}
          held={
            (session.phase === 'not-started' && !live[session.id]) ||
            waitingForWorktree[session.id] !== undefined ||
            runSessionWaits(session, runStarts, live[session.id] !== undefined)
          }
          live={live[session.id] !== undefined || eager[session.id] === true}
          resumeAgentSessionId={requests[session.id]?.resumeAgentSessionId}
          generation={requests[session.id]?.generation ?? 0}
        />
      ))}
      {activeSessionId && placements[activeSessionId] && (
        <div className={styles.searchSlot} style={place(placements[activeSessionId])}>
          <TerminalSearch key={activeSessionId} sessionId={activeSessionId} />
        </div>
      )}
    </div>
  )
}

/**
 * A secondary window's panes (F20 · 多窗口): each borrows its session's terminal from the main window's TerminalArea,
 * which keeps owning it (spawn, attach, restart). Clicking or focusing a pane gives it the keyboard as in the main window.
 */
export function PaneHosts({ placements }: { placements: Readonly<Record<SessionId, Rect>> }) {
  const { win } = useWindowScope()
  const isKey = useIsKeyWindow()
  const activeSessionId = useWorkspace((s) => s.activeSessionId)
  useResyncOnWake(Object.keys(placements).join('\n'), win)
  return (
    <div className={styles.area} data-region="terminal">
      {Object.entries(placements).map(([sessionId, rect]) => (
        <PaneHost key={sessionId} sessionId={sessionId} rect={rect} active={isKey && sessionId === activeSessionId} />
      ))}
      {isKey && activeSessionId && placements[activeSessionId] && (
        <div className={styles.searchSlot} style={place(placements[activeSessionId])}>
          <TerminalSearch key={activeSessionId} sessionId={activeSessionId} />
        </div>
      )}
    </div>
  )
}

function PaneHost({ sessionId, rect, active }: { sessionId: SessionId; rect: Rect; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    return borrowTerminal(sessionId, host)
  }, [sessionId])
  return (
    <div
      className={styles.pane}
      data-active={active}
      data-shown
      data-session-id={sessionId}
      style={place(rect)}
      onClick={() => getSurface(sessionId)?.focus()}
      onFocus={() => useWorkspace.getState().focusPane(sessionId)}
    >
      <div ref={hostRef} className={styles.host} />
    </div>
  )
}

const archivedWorktree = (worktrees: readonly Worktree[], id: string): boolean => worktrees.find((w) => w.id === id)?.archived !== undefined
