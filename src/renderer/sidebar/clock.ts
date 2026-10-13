// One shared coarse timer for every elapsed label. It only notifies; each label decides
// (via its formatted string) whether it actually needs to re-render.
const TICK_MS = 15_000

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

export function subscribeClock(listener: () => void): () => void {
  listeners.add(listener)
  if (timer === null) timer = setInterval(() => listeners.forEach((l) => l()), TICK_MS)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}
