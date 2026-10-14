// Tells main how many sessions are running or waiting for the user, so quitting can ask first.
import { countActive } from '@shared/lifecycle'
import { useWorkspace } from './workspace'

const activeCount = (): number => countActive(useWorkspace.getState().sessions.map((s) => s.status))

/** Reports now and again whenever the count changes; returns the unsubscribe function. */
export function startActivityReporting(): () => void {
  let last = -1
  const report = (): void => {
    const active = activeCount()
    if (active === last) return
    last = active
    window.tr.app.reportActivity({ active })
  }
  report()
  return useWorkspace.subscribe((state, prev) => {
    if (state.sessions !== prev.sessions) report()
  })
}
