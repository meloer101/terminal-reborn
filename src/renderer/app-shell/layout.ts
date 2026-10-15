// Window layout rules (phase 2b · B13). Pure, so the breakpoints are unit-tested.
// Widths mirror tokens.css (--sidebar-width, --panel-width-*, --main-min-width).
import type { RightPanelTab } from '../state/workspace'

export const SIDEBAR_WIDTH = 264
export const MAIN_MIN_WIDTH = 560
export const PANEL_WIDTH: Record<RightPanelTab, number> = { changes: 440, graph: 560 }

/** docked = a column beside main; overlay = floats over main's right edge, so main never drops below its minimum. */
export type PanelMode = 'docked' | 'overlay'

export function panelMode(windowWidth: number, sidebarShown: boolean, tab: RightPanelTab): PanelMode {
  const left = windowWidth - (sidebarShown ? SIDEBAR_WIDTH : 0) - PANEL_WIDTH[tab]
  return left >= MAIN_MIN_WIDTH ? 'docked' : 'overlay'
}
