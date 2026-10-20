// Window layout rules (phase 2b · B13, F17). Pure, so the breakpoints are unit-tested.
// Widths mirror tokens.css (--panel-inset, --main-min-width); the sidebar's and the panel's widths are the user's.

import { SIDEBAR_WIDTH_MIN } from '@shared/workspace-file'

export const MAIN_MIN_WIDTH = 560
/** The right panel card's inset from the window's top, right and bottom edges. */
export const PANEL_INSET = 8

/** docked = a column beside main; overlay = floats over main's right edge, so main never drops below its minimum. */
export type PanelMode = 'docked' | 'overlay'

/** The sidebar's width as shown: the saved width, narrowed so main keeps its minimum (never below the sidebar's own). */
export function sidebarWidthFor(windowWidth: number, savedWidth: number): number {
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(savedWidth, windowWidth - MAIN_MIN_WIDTH))
}

/** `sidebarWidth` is 0 when the sidebar is hidden; `panelWidth` is the card's own width (docked, plus the right inset). */
export function panelMode(windowWidth: number, sidebarWidth: number, panelWidth: number): PanelMode {
  const left = windowWidth - sidebarWidth - panelWidth - PANEL_INSET
  return left >= MAIN_MIN_WIDTH ? 'docked' : 'overlay'
}
