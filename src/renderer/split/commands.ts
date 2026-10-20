// The split's keyboard commands (PRD F20): ⌘D / ⇧⌘D split the focused pane right / down (the new pane picks its
// session first), ⌥⌘W closes the focused pane, ⌥⌘ arrows move the keyboard to the neighbouring pane.
import { adjacentPane, canSplit, hasPane, PICKER_PANE, type Direction, type Side } from '@shared/split-layout'
import type { SessionId } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { currentPanes, currentRoot, useSplitGeometry } from './store'

/** The picker's pane, when it has the keyboard. */
const PICKER_SELECTOR = `[data-pane-id="${PICKER_PANE}"]`

/** A sheet or dialog over the window owns the keyboard: the split's keys do nothing behind it. */
function modalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

function pickerHasFocus(): boolean {
  return document.activeElement?.closest(PICKER_SELECTOR) != null
}

/** Puts the keyboard in the picker's filter field (it mounts a frame later when just opened). */
export function focusPicker(): void {
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`${PICKER_SELECTOR} input`)?.focus())
}

/** The pane the keyboard is in: the picker's, or the active session's. */
function focusedPane(): SessionId | null {
  return pickerHasFocus() ? PICKER_PANE : useWorkspace.getState().activeSessionId
}

/** ⌘D / ⇧⌘D. With a picker already open the keyboard goes back to it; where no pane fits, nothing happens. */
export function splitFocusedPane(side: Extract<Side, 'right' | 'bottom'>): void {
  const state = useWorkspace.getState()
  const root = currentRoot()
  const active = state.activeSessionId
  if (!root || !active || state.mainView !== 'session' || modalOpen()) return
  if (hasPane(root, PICKER_PANE)) {
    focusPicker()
    return
  }
  if (!canSplit(root, active, side, useSplitGeometry.getState().area)) return
  if (state.openPicker(side)) focusPicker()
}

/** ⌥⌘W: closes the pane the keyboard is in; its session keeps running. */
export function closeFocusedPane(): void {
  const state = useWorkspace.getState()
  const id = focusedPane()
  if (state.mainView !== 'session' || !id || !state.split || modalOpen()) return
  state.closePane(id)
}

/** ⌥⌘ arrows: the keyboard moves to the pane on that side. */
export function focusPaneToward(dir: Direction): void {
  const state = useWorkspace.getState()
  const from = focusedPane()
  if (state.mainView !== 'session' || !from || !state.split || modalOpen()) return
  const next = adjacentPane(currentPanes(), from, dir)
  if (!next) return
  if (next === PICKER_PANE) focusPicker()
  else state.setActiveSession(next)
}
