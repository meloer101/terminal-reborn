// Window layout rules (phase 2b · B13, F17). Pure, so the breakpoints are unit-tested.
// Widths mirror tokens.css (--card-gap, --main-min-width); the sidebar's and the panel's widths are the user's. Main's
// minimum counts inside the surface's padding (AppShell .surface), so the glass at the window's edge never squeezes it.

import { PANEL_WIDTH_MIN, SIDEBAR_WIDTH_MIN } from '@shared/workspace-file'

export const MAIN_MIN_WIDTH = 560
/** The glass between the right panel's card and main (= --card-gap). */
export const PANEL_INSET = 6
/** The glass between the cards and the window's right edge — and the left edge too while the sidebar is hidden (= --card-gap). */
export const WINDOW_INSET = 6

/** The glass left and right of the cards' surface: the sidebar column is the left side's while the sidebar is shown. */
const surfaceGutters = (sidebarWidth: number): number => WINDOW_INSET * (sidebarWidth > 0 ? 1 : 2)
/** A pane's header, its card's top row (= --titlebar-height). */
export const HEADER_HEIGHT = 36

/** docked = a column beside main; overlay = floats over main's right edge, so main never drops below its minimum. */
export type PanelMode = 'docked' | 'overlay'

/** The sidebar's width as shown: the saved width, narrowed so main keeps its minimum (never below the sidebar's own). */
export function sidebarWidthFor(windowWidth: number, savedWidth: number): number {
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(savedWidth, windowWidth - WINDOW_INSET - MAIN_MIN_WIDTH))
}

/**
 * The right panel's width as shown: the saved width, narrowed so main keeps its minimum — never below the panel's own
 * minimum (then it floats, panelMode). `sidebarWidth` is 0 when the sidebar is hidden. The saved width stays as it is.
 */
export function panelWidthFor(windowWidth: number, sidebarWidth: number, savedWidth: number): number {
  return Math.max(PANEL_WIDTH_MIN, Math.min(savedWidth, windowWidth - sidebarWidth - surfaceGutters(sidebarWidth) - PANEL_INSET - MAIN_MIN_WIDTH))
}

/** `sidebarWidth` is 0 when the sidebar is hidden; `panelWidth` is the card's own width as shown (panelWidthFor). */
export function panelMode(windowWidth: number, sidebarWidth: number, panelWidth: number): PanelMode {
  const left = windowWidth - sidebarWidth - surfaceGutters(sidebarWidth) - panelWidth - PANEL_INSET
  return left >= MAIN_MIN_WIDTH ? 'docked' : 'overlay'
}
