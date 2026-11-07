// Dispatch in a window (PRD F21): answers agents' `wavi` commands and reports back to dispatchers, 同任务多解's sessions
// too (F4 v1.68). Started once by the shell.
import { DEFAULT_SETTINGS } from '@shared/settings'
import { handleWaviRequest, resumeConfirmTimers, setDispatchSettings } from './handler'
import { startAttemptReports } from '../attempts/report'
import { addSnapshotPart, initialWorkspaceFile, requestSave } from '../state/persistence'
import { resumeReports, startReports } from './reports'
import { restoreDispatch, savedDispatch, useDispatch } from './store'

let started = false

export function startDispatchBridge(): () => void {
  if (started) return () => {}
  started = true
  setDispatchSettings(DEFAULT_SETTINGS.dispatch)
  void window.tr.settings.get().then((s) => setDispatchSettings(s.dispatch))
  const offSettings = window.tr.settings.onChange((s) => setDispatchSettings(s.dispatch))
  const offRequests = window.tr.dispatch.onRequest((request) => {
    void handleWaviRequest(request).then((result) => window.tr.dispatch.reply(request.callId, result))
  })
  const offReports = startReports()
  // What an earlier window left waiting comes back (a reload, a crash, a restart): saved with the workspace.
  restoreDispatch(initialWorkspaceFile()?.dispatch)
  resumeConfirmTimers()
  resumeReports()
  const offSnapshot = addSnapshotPart(() => {
    const dispatch = savedDispatch(useDispatch.getState())
    return dispatch ? { dispatch } : {}
  })
  const offSaves = useDispatch.subscribe((s, prev) => {
    if (s.confirms !== prev.confirms || s.queues !== prev.queues || s.held !== prev.held) requestSave()
  })
  // 同任务多解's members report through the same channels (attempts/report.ts).
  const offAttempts = startAttemptReports()
  return () => {
    offAttempts()
    offSaves()
    offSnapshot()
    started = false
    offSettings()
    offRequests()
    offReports()
  }
}
