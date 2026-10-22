// Dispatch in a window (PRD F21): answers agents' tool calls and reports back to dispatchers. Started once by the shell.
import { DEFAULT_SETTINGS } from '@shared/settings'
import { handleDispatchRequest, setDispatchSettings } from './handler'
import { startReports } from './reports'

let started = false

export function startDispatchBridge(): () => void {
  if (started) return () => {}
  started = true
  setDispatchSettings(DEFAULT_SETTINGS.dispatch)
  void window.tr.settings.get().then((s) => setDispatchSettings(s.dispatch))
  const offSettings = window.tr.settings.onChange((s) => setDispatchSettings(s.dispatch))
  const offRequests = window.tr.dispatch.onRequest((request) => {
    void handleDispatchRequest(request).then((result) => window.tr.dispatch.reply(request.callId, result))
  })
  const offReports = startReports()
  return () => {
    started = false
    offSettings()
    offRequests()
    offReports()
  }
}
