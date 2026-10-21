// The window a component is drawn in (PRD F20 · 多窗口); hooks over it are in ./window-scope.
import { createContext } from 'react'
import { MAIN_WINDOW, type WindowKey } from '@shared/window-layout'

export interface WindowScopeValue {
  key: WindowKey
  /** The window's global object: its document, its events. */
  win: Window
}

export const WindowScopeContext = createContext<WindowScopeValue>({ key: MAIN_WINDOW, win: window })
