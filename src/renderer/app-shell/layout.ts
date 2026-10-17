// Window layout rules (phase 2b · B13, F17). Pure, so the breakpoints are unit-tested.
// Widths mirror tokens.css (--sidebar-width, --panel-inset, --main-min-width).

export const SIDEBAR_WIDTH = 264
export const MAIN_MIN_WIDTH = 560
/** The right panel card's inset from the window's top, right and bottom edges. */
export const PANEL_INSET = 8

/** docked = a column beside main; overlay = floats over main's right edge, so main never drops below its minimum. */
export type PanelMode = 'docked' | 'overlay'

/** `panelWidth` is the card's own width; docked, its column is that plus the right inset. */
export function panelMode(windowWidth: number, sidebarShown: boolean, panelWidth: number): PanelMode {
  const left = windowWidth - (sidebarShown ? SIDEBAR_WIDTH : 0) - panelWidth - PANEL_INSET
  return left >= MAIN_MIN_WIDTH ? 'docked' : 'overlay'
}

