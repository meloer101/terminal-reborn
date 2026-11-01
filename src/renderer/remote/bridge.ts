// 手机远程 in the window (PRD F22): while 允许手机连接 is on, tells main about its sessions whenever they change, and
// carries out what main forwards from the phone. Started once by the shell.
import { DEFAULT_SETTINGS } from '@shared/settings'
import { useWorkspace } from '../state/workspace'
import { handleRemoteCommand } from './handler'
import { remoteSessions } from './model'

/** Status lines change several times a second while agents run; the phone list does not need every one. */
const PUBLISH_MS = 300

let started = false

export function startRemoteBridge(): () => void {
  if (started) return () => {}
  started = true
  let enabled = DEFAULT_SETTINGS.remote.enabled
  let last = ''
  let timer: number | null = null
  const publish = () => {
    if (!enabled || timer !== null) return
    timer = window.setTimeout(() => {
      timer = null
      const list = remoteSessions(useWorkspace.getState())
      const text = JSON.stringify(list)
      if (text === last) return
      last = text
      window.tr.remote.publishSessions(list)
    }, PUBLISH_MS)
  }
  const setEnabled = (on: boolean) => {
    enabled = on
    last = ''
    publish()
  }
  void window.tr.settings.get().then((s) => setEnabled(s.remote.enabled))
  const offSettings = window.tr.settings.onChange((s) => {
    if (s.remote.enabled !== enabled) setEnabled(s.remote.enabled)
  })
  const offStore = useWorkspace.subscribe(publish)
  const offRequests = window.tr.remote.onRequest((request) => {
    void handleRemoteCommand(request.command).then((result) => window.tr.remote.reply(request.callId, result))
  })
  return () => {
    started = false
    if (timer !== null) window.clearTimeout(timer)
    offSettings()
    offStore()
    offRequests()
  }
}
