// Which window a component is drawn in (PRD F20 · 多窗口). The renderer draws every window itself: the main window's
// page, and secondary windows it opened (app-shell/secondary-windows.tsx), each a React root under its own scope.
// Components that show "the active session" read their own window's panes through these hooks; actions still act on
// the key window (the store's top-level panes), which is the window the user is in.
import { useContext } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { MAIN_WINDOW, type PaneView, type SecondaryWindow, type WindowKey } from '@shared/window-layout'
import { WindowScopeContext, type WindowScopeValue } from './window-context'
import { paneViewOf, useWorkspace } from './workspace'

export { WindowScopeContext, type WindowScopeValue }

export const useWindowScope = (): WindowScopeValue => useContext(WindowScopeContext)

export const useWindowKey = (): WindowKey => useContext(WindowScopeContext).key

/** This window's panes. */
export function usePaneView(): PaneView {
  const key = useWindowKey()
  return useWorkspace(useShallow((s) => paneViewOf(s, key)))
}

/** Whether the keyboard is in this window. */
export function useIsKeyWindow(): boolean {
  const key = useWindowKey()
  return useWorkspace((s) => s.keyWindow === key)
}

/** This window's record; null in the main window. */
export function useSecondaryWindow(): SecondaryWindow | null {
  const key = useWindowKey()
  return useWorkspace((s) => (key === MAIN_WINDOW ? null : (s.windows.find((w) => w.key === key) ?? null)))
}

/** Whether this window's sidebar is hidden. */
export function useSidebarCollapsed(): boolean {
  const key = useWindowKey()
  return useWorkspace((s) => (key === MAIN_WINDOW ? s.sidebarCollapsed : (s.windows.find((w) => w.key === key)?.sidebarCollapsed ?? false)))
}
