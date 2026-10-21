// ⌘+ / ⌘- / ⌘0 while the main area is split (PRD F20): only the focused pane's terminal changes size, and ⌘0 brings
// it back to the setting; when the split ends every pane goes back to the setting. Without a split the keys are
// left to the app menu, which changes the setting itself (F8).
import type { FontSizeStep } from '@shared/shortcuts'
import { useWorkspace } from '../state/workspace'
import { everyWindow, keyDocument } from '../app-shell/windows-runtime'
import { showsPanes } from './store'
import { clearTerminalZoom, stepTerminalZoom } from '../terminal/registry'

function stepOf(e: KeyboardEvent): FontSizeStep | null {
  if (!e.metaKey || e.ctrlKey || e.altKey) return null
  if (e.code === 'Equal') return 'bigger'
  if (e.code === 'Minus' && !e.shiftKey) return 'smaller'
  if (e.code === 'Digit0' && !e.shiftKey) return 'reset'
  return null
}

const onKeyDown = (e: KeyboardEvent): void => {
  const step = stepOf(e)
  if (!step) return
  const { split, activeSessionId, keyWindow } = useWorkspace.getState()
  if (!split || !activeSessionId || !showsPanes(keyWindow)) return
  // A sheet or dialog in front keeps its own keys.
  if (keyDocument().querySelector('[role="dialog"][aria-modal="true"]')) return
  e.preventDefault()
  e.stopPropagation()
  stepTerminalZoom(activeSessionId, step)
}

const uninstall = everyWindow((win) => {
  win.addEventListener('keydown', onKeyDown, true)
  return () => win.removeEventListener('keydown', onKeyDown, true)
})
// The split ended (not: the keyboard moved to a window without one).
const unsubscribe = useWorkspace.subscribe((state, prev) => {
  if (prev.split && !state.split && state.keyWindow === prev.keyWindow) clearTerminalZoom()
})
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    uninstall()
    unsubscribe()
  })
}
