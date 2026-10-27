// Opening and closing the sidebar and the right panel (PRD §5 玻璃外壳 · 动效). A drawer's width springs between 0
// and its own while its content slides in from that edge; the cards beside it follow the width. Terminals keep their
// grid while a drawer moves and refit once when it settles, so the agents' TUIs see one resize, not thirty.
import { useLayoutEffect, useState, type RefObject } from 'react'

/** Keep in step with --motion-duration-drawer (tokens.css). */
export const DRAWER_MS = 460

/**
 * closed → enter (mounted at width 0 for one layout) → opening (springs to full width) → open;
 * open → closing (back to 0) → closed (unmounted).
 */
export type DrawerPhase = 'closed' | 'enter' | 'opening' | 'open' | 'closing'

/** The phase a drawer moves to when it is asked to be open or closed; null when it stays where it is. */
export function drawerPhaseFor(phase: DrawerPhase, wantOpen: boolean): DrawerPhase | null {
  if (wantOpen) return phase === 'closed' ? 'enter' : phase === 'closing' ? 'opening' : null
  return phase === 'closed' || phase === 'closing' ? null : 'closing'
}

/** True while the drawer takes its full width (the width transition runs towards it). */
export function drawerIsWide(phase: DrawerPhase): boolean {
  return phase === 'opening' || phase === 'open'
}

let held = false
let release = 0
const released = new Set<() => void>()

/** Terminals skip resizes until DRAWER_MS from now, then refit once. */
function holdTerminalFit(): void {
  held = true
  window.clearTimeout(release)
  release = window.setTimeout(() => {
    held = false
    for (const listener of released) listener()
  }, DRAWER_MS)
}

export function terminalFitHeld(): boolean {
  return held
}

export function onTerminalFitReleased(listener: () => void): () => void {
  released.add(listener)
  return () => released.delete(listener)
}

/**
 * Keeps a drawer mounted through its closing motion. `value` is what it shows (null = closed); `shown` is the last
 * non-null value, so a closing panel keeps its view until it is gone. A drawer that starts open does not animate.
 * `ref` is the drawer's element (the one whose width moves).
 */
export function useDrawer<T>(value: T | null, ref: RefObject<HTMLElement | null>): { shown: T | null; phase: DrawerPhase } {
  const [state, setState] = useState<{ shown: T | null; phase: DrawerPhase }>(() => ({ shown: value, phase: value === null ? 'closed' : 'open' }))

  // Render-phase update (React's "adjusting state when a prop changes"): no frame shows the stale phase.
  const next = drawerPhaseFor(state.phase, value !== null)
  if (next) {
    holdTerminalFit()
    setState({ shown: value ?? state.shown, phase: next })
  } else if (value !== null && value !== state.shown) {
    setState({ shown: value, phase: state.phase })
  }

  useLayoutEffect(() => {
    if (state.phase === 'enter') {
      // Lay the drawer out at width 0 first, so the width transition has somewhere to start from; the switch to the
      // full width still lands before the frame is painted.
      void ref.current?.offsetWidth
      queueMicrotask(() => setState((s) => (s.phase === 'enter' ? { ...s, phase: 'opening' } : s)))
      return
    }
    if (state.phase !== 'opening' && state.phase !== 'closing') return
    const timer = window.setTimeout(
      () => setState((s) => (s.phase === 'opening' ? { ...s, phase: 'open' } : s.phase === 'closing' ? { shown: null, phase: 'closed' } : s)),
      DRAWER_MS
    )
    return () => window.clearTimeout(timer)
  }, [state.phase, ref])

  return state
}
