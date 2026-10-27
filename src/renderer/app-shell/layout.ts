// Window layout rules (phase 2b · B13, F17). Pure, so the breakpoints are unit-tested.
// Widths mirror tokens.css (--card-gap, --main-min-width); the sidebar's and the panel's widths are the user's.

import { PANEL_WIDTH_MIN, SIDEBAR_WIDTH_MIN } from '@shared/workspace-file'

export const MAIN_MIN_WIDTH = 560
/** The glass between the right panel's card and main, and the window's right edge (= --card-gap). */
export const PANEL_INSET = 6

/** docked = a column beside main; overlay = floats over main's right edge, so main never drops below its minimum. */
export type PanelMode = 'docked' | 'overlay'

/** The sidebar's width as shown: the saved width, narrowed so main keeps its minimum (never below the sidebar's own). */
export function sidebarWidthFor(windowWidth: number, savedWidth: number): number {
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(savedWidth, windowWidth - MAIN_MIN_WIDTH))
}

/**
 * The right panel's width as shown: the saved width, narrowed so main keeps its minimum — never below the panel's own
 * minimum (then it floats, panelMode). `sidebarWidth` is 0 when the sidebar is hidden. The saved width stays as it is.
 */
export function panelWidthFor(windowWidth: number, sidebarWidth: number, savedWidth: number): number {
  return Math.max(PANEL_WIDTH_MIN, Math.min(savedWidth, windowWidth - sidebarWidth - PANEL_INSET - MAIN_MIN_WIDTH))
}

/** `sidebarWidth` is 0 when the sidebar is hidden; `panelWidth` is the card's own width as shown (panelWidthFor). */
export function panelMode(windowWidth: number, sidebarWidth: number, panelWidth: number): PanelMode {
  const left = windowWidth - sidebarWidth - panelWidth - PANEL_INSET
  return left >= MAIN_MIN_WIDTH ? 'docked' : 'overlay'
}
