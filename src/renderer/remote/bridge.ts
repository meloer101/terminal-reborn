// 手机远程 in the window (PRD F22): while 允许手机连接 is on, tells main about its sessions whenever they change, and
// carries out what main forwards from the phone. Started once by the shell.
import { DEFAULT_SETTINGS } from '@shared/settings'
import { useGuiSessions } from '../gui/store'
import { useShips } from '../pull-requests/ship-runner'
import { usePullRequests } from '../pull-requests/store'
import { useSessionMeta } from '../session-meta/store'
import { sessionSettings } from '../session-settings'
import { useWorkspace } from '../state/workspace'
import { handleRemoteCommand } from './handler'
import { remoteSessions } from './model'

/** Status lines change several times a second while agents run; the phone list does not need every one. */
const PUBLISH_MS = 300
/** An exit's result notice comes right after its run is gone (ship-runner.ts `finish`); later notices are other things. */
const ENDING_MS = 3000

let started = false

export function startRemoteBridge(): () => void {
  if (started) return () => {}
  started = true
  let enabled = DEFAULT_SETTINGS.remote.enabled
  let last = ''
  let timer: number | null = null
  // How each worktree's last exit ended, for the phone's 45J: the notice set within ENDING_MS of its run ending, not the
  // auto-fix or comment notices that share the same place; a new run clears it.
  const endings: Record<string, string> = {}
  const endedAt: Record<string, number> = {}
  const publish = () => {
    if (!enabled || timer !== null) return
    timer = window.setTimeout(() => {
      timer = null
      const list = remoteSessions(useWorkspace.getState(), { ships: useShips.getState().byWorktree, endings }, sessionSettings)
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
  // A GUI session's pickers change in its own store (the phone's 会话设置, Figma 64B).
  const offGui = useGuiSessions.subscribe((state, before) => {
    if (Object.keys(state.states).some((id) => state.states[id]?.config !== before.states[id]?.config)) publish()
  })
  // What a terminal agent reports of its model, effort and permission (hooks, statusLine).
  const offMeta = useSessionMeta.subscribe((state, before) => {
    if (Object.keys(state.bySession).some((id) => state.bySession[id]?.settings !== before.bySession[id]?.settings)) publish()
  })
  // An exit's steps and how it ended show on the phone (Figma 45J).
  const offShips = useShips.subscribe((state, before) => {
    for (const path of Object.keys(state.byWorktree)) if (!before.byWorktree[path]) delete endings[path]
    for (const path of Object.keys(before.byWorktree)) if (!state.byWorktree[path]) endedAt[path] = Date.now()
    publish()
  })
  const offNotices = usePullRequests.subscribe((state, before) => {
    if (state.notice === before.notice) return
    for (const [path, notice] of Object.entries(state.notice)) {
      if (notice !== before.notice[path] && Date.now() - (endedAt[path] ?? 0) < ENDING_MS) endings[path] = notice.text
    }
    publish()
  })
  const offRequests = window.tr.remote.onRequest((request) => {
    void handleRemoteCommand(request.command).then((result) => window.tr.remote.reply(request.callId, result))
  })
  return () => {
    started = false
    if (timer !== null) window.clearTimeout(timer)
    offSettings()
    offStore()
    offGui()
    offMeta()
    offShips()
    offNotices()
    offRequests()
  }
}
