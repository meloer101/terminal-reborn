// The phone's 会话设置 in the window (PRD F22 v1.144, Figma 64B–64F): what a session's model, effort and permission are
// and what they can be, and setting one for this session only. A GUI session goes through its composer pickers (the
// same call the desktop's pickers make, PRD F23); Claude in a terminal by typing into its TUI (claude-terminal.ts).
// Other agents' terminals offer nothing yet (shared/terminal-settings.ts says why).
import { remoteFail, type RemoteResult } from '@shared/remote'
import { guiSettingChanges, guiSettings, type SessionSettings, type SettingKind } from '@shared/session-settings'
import { claudeTerminalSettings } from '@shared/terminal-settings'
import type { Session } from '@shared/types'
import { guiStateOf } from '../gui/store'
import { useSessionMeta } from '../session-meta/store'
import { useWorkspace } from '../state/workspace'
import { setClaudeInTerminal } from './claude-terminal'

/** What the phone shows for `session`; undefined when it can change nothing there. */
export function sessionSettings(session: Session): SessionSettings | undefined {
  if (session.ui === 'gui') return guiSettings(guiStateOf(session.id).config)
  if (session.kind === 'claude' && session.phase === 'ready') {
    const reported = useSessionMeta.getState().bySession[session.id]?.settings ?? {}
    return claudeTerminalSettings(reported, session.status === 'running' || session.status === 'needs_you')
  }
  return undefined
}

export async function setSessionSetting(sessionId: string, kind: SettingKind, value: string): Promise<RemoteResult> {
  const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
  if (!session || session.kind === 'shell') return remoteFail('会话不存在')
  if (session.ui === 'gui') {
    const changes = guiSettingChanges(guiStateOf(sessionId).config, kind, value)
    if (!changes) return remoteFail('这个会话没有这个选项')
    for (const change of changes) {
      if (!(await window.tr.gui.setConfig(sessionId, change.option, change.value))) return remoteFail('agent 没有接受这个设置')
    }
    return { ok: true }
  }
  if (session.kind === 'claude') return setClaudeInTerminal(session, kind, value)
  return remoteFail('这个会话不能在手机上改')
}
