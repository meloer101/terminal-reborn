// ⌘+ / ⌘- / ⌘0 while the main area is split (PRD F20): only the focused pane's terminal changes size, and ⌘0 brings
// it back to the setting; when the split ends every pane goes back to the setting. Without a split the keys are
// left to the app menu, which changes the setting itself (F8).
import type { FontSizeStep } from '@shared/shortcuts'
import { useWorkspace } from '../state/workspace'
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
  const { split, activeSessionId, mainView } = useWorkspace.getState()
  if (!split || !activeSessionId || mainView !== 'session') return
  // A sheet or dialog in front keeps its own keys.
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
  e.preventDefault()
  e.stopPropagation()
  stepTerminalZoom(activeSessionId, step)
}

window.addEventListener('keydown', onKeyDown, true)
const unsubscribe = useWorkspace.subscribe((state, prev) => {
  if (prev.split && !state.split) clearTerminalZoom()
})
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener('keydown', onKeyDown, true)
    unsubscribe()
  })
}
