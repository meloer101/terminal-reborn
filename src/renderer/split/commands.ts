// The split's keyboard commands (PRD F20): ⌘D / ⇧⌘D split the focused pane right / down (the new pane picks its
// session first), ⌥⌘W closes the focused pane, ⌥⌘ arrows move the keyboard to the neighbouring pane.
import { adjacentPane, canSplit, hasPane, PICKER_PANE, type Direction, type Side } from '@shared/split-layout'
import type { SessionId } from '@shared/types'
import { projectOfSession } from '../state/workspace-model'
import { useWorkspace } from '../state/workspace'
import { keyDocument, windowOf } from '../app-shell/windows-runtime'
import { currentPanes, currentRoot, geometryOf, showsPanes } from './store'

/** The picker's pane, when it has the keyboard. */
const PICKER_SELECTOR = `[data-pane-id="${PICKER_PANE}"]`

/** A sheet or dialog over the window owns the keyboard: the split's keys do nothing behind it. */
function modalOpen(): boolean {
  return keyDocument().querySelector('[role="dialog"][aria-modal="true"]') !== null
}

function pickerHasFocus(): boolean {
  return keyDocument().activeElement?.closest(PICKER_SELECTOR) != null
}

/** Puts the keyboard in the picker's filter field (it mounts a frame later when just opened). */
export function focusPicker(): void {
  requestAnimationFrame(() => keyDocument().querySelector<HTMLInputElement>(`${PICKER_SELECTOR} input`)?.focus())
}

/** The key window shows its panes (not the main window's overview). */
const panesShown = (): boolean => showsPanes(useWorkspace.getState().keyWindow)

/** The pane the keyboard is in: the picker's, or the active session's. */
function focusedPane(): SessionId | null {
  return pickerHasFocus() ? PICKER_PANE : useWorkspace.getState().activeSessionId
}

/** ⌘D / ⇧⌘D. With a picker already open the keyboard goes back to it; where no pane fits, nothing happens. */
export function splitFocusedPane(side: Extract<Side, 'right' | 'bottom'>): void {
  const state = useWorkspace.getState()
  const root = currentRoot()
  const active = state.activeSessionId
  if (!root || !active || !panesShown() || modalOpen()) return
  if (hasPane(root, PICKER_PANE)) {
    focusPicker()
    return
  }
  if (!canSplit(root, active, side, geometryOf().area)) return
  if (state.openPicker(side)) focusPicker()
}

/** ⌥⌘W: closes the pane the keyboard is in; its session keeps running. */
export function closeFocusedPane(): void {
  const state = useWorkspace.getState()
  const id = focusedPane()
  if (!panesShown() || !id || !state.split || modalOpen()) return
  state.closePane(id)
}

/** ⌥⌘ arrows: the keyboard moves to the pane on that side. */
export function focusPaneToward(dir: Direction): void {
  const state = useWorkspace.getState()
  const from = focusedPane()
  if (!panesShown() || !from || !state.split || modalOpen()) return
  const next = adjacentPane(currentPanes(), from, dir)
  if (!next) return
  if (next === PICKER_PANE) focusPicker()
  else state.setActiveSession(next)
}

/** The default size of a window a session moves to. */
const NEW_WINDOW = { width: 1100, height: 760 }

/**
 * Opens a session in a new window of its own (F20 · 多窗口): a pane dragged out of its window (at the point it was
 * dropped, in screen coordinates), or 显示 › 把这一格移到新窗口. The session leaves the window that showed it.
 */
export function moveSessionToNewWindow(id: SessionId, at?: { screenX: number; screenY: number; width?: number; height?: number }): void {
  const state = useWorkspace.getState()
  if (!state.sessions.some((s) => s.id === id)) return
  const source = windowOf(state.keyWindow) ?? window
  const width = Math.max(720, Math.round(at?.width ?? NEW_WINDOW.width))
  const height = Math.max(480, Math.round(at?.height ?? NEW_WINDOW.height))
  // Under the pointer, the title bar where it was grabbed; without one, offset from the window it came from.
  const x = at ? at.screenX - 80 : source.screenX + 48
  const y = at ? at.screenY - 22 : source.screenY + 48
  state.openWindow({ projectId: projectOfSession(state, id), sessionId: id, bounds: { x, y, width, height }, sidebarCollapsed: true })
}

/** 显示 › 把这一格移到新窗口: the pane the keyboard is in, as a window of about its size, offset from this one. */
export function moveFocusedPaneToNewWindow(): void {
  const state = useWorkspace.getState()
  const id = state.activeSessionId
  if (!id || !panesShown() || modalOpen() || pickerHasFocus()) return
  const pane = currentPanes().find((p) => p.id === id)
  const source = windowOf(state.keyWindow) ?? window
  moveSessionToNewWindow(id, { screenX: source.screenX + 128, screenY: source.screenY + 70, ...(pane ? { width: pane.width, height: pane.height } : {}) })
}
