// Whether the main window is full screen (PRD v1.97 全屏背景): main says so on every change and on every load.
import { useSyncExternalStore } from 'react'

let fullScreen = false
const listeners = new Set<() => void>()
let listening = false

function subscribe(listener: () => void): () => void {
  if (!listening) {
    listening = true
    window.tr.ui.onFullScreen((next) => {
      fullScreen = next
      for (const l of listeners) l()
    })
  }
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useMainFullScreen(): boolean {
  return useSyncExternalStore(subscribe, () => fullScreen)
}
