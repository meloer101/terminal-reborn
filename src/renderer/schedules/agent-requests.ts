// `wavi schedule` (PRD F24, Figma 67J′): an agent asks for a 定时任务. Like `wavi run` (F21) the request is the user's
// to answer: it waits under the agent's terminal (ScheduleConfirmStrip) and its session shows 等你处理 meanwhile; 开始
// makes the task — expiring in 7 days unless the user keeps it — and 拒绝 drops it. The agent is told either way.
// `wavi schedules` / `wavi unschedule` see and remove only the tasks this session made.
import { create } from 'zustand'
import { agentName } from '@shared/agents'
import { waviFail, waviOk, type DispatchRequest, type WaviCommand, type WaviResult } from '@shared/dispatch'
import { AGENT_SCHEDULE_TTL_MS, monthDay, parseDraft, runLabel, timingLabel, type ScheduleDraft, type ScheduleTiming } from '@shared/schedule'
import type { SessionId } from '@shared/types'
import type { Place } from '../dispatch/places'
import { deliverMessage } from '../dispatch/reports'
import { onceAt } from './model'
import { useSchedules } from './store'

export { scheduleRequestCounts } from './model'

export interface ScheduleRequest {
  callId: string
  sessionId: SessionId
  draft: ScheduleDraft
  /** Shown on the strip: when it would stop. */
  expiresAt: number
}

export const useScheduleRequests = create<{ pending: ScheduleRequest[] }>()(() => ({ pending: [] }))

let agentsAllowed = true

/** 设置 · 自动化 · 让 agent 建定时任务. */
export function setAgentSchedulesAllowed(allowed: boolean): void {
  agentsAllowed = allowed
}

type ScheduleCommand = Extract<WaviCommand, { name: 'schedule' | 'schedules' | 'unschedule' }>

function timingOf(command: Extract<WaviCommand, { name: 'schedule' }>, now: number): ScheduleTiming | null {
  const w = command.when
  if ('every' in w) return { kind: 'interval', minutes: w.every }
  if ('daily' in w) return { kind: 'daily', time: w.daily }
  if ('weekdays' in w) return { kind: 'weekdays', time: w.weekdays }
  const at = onceAt(w.at, now)
  return at === null ? null : { kind: 'once', at }
}

async function request(caller: Place, call: DispatchRequest, command: Extract<WaviCommand, { name: 'schedule' }>): Promise<WaviResult> {
  if (!agentsAllowed) return waviFail('not_allowed', 'The user turned off scheduled tasks for agents in Wavi (设置 · 自动化 · 定时任务).')
  const now = Date.now()
  const timing = timingOf(command, now)
  if (!timing) return waviFail('invalid_request', '--at is in the past.')
  const name = (command.title ?? command.text.split('\n').find((l) => l.trim()) ?? '定时任务').trim().slice(0, 60)
  let action: ScheduleDraft['action']
  if (command.agent) {
    const info = await window.tr.gitWorktrees.newSessionInfo(caller.project.rootPath)
    if (!info.repo || !info.defaultBranch) return waviFail('not_allowed', 'This project is not a git repository, so a new session cannot get its own worktree. Leave out --new.')
    action = { kind: 'new', projectId: caller.project.id, base: info.defaultBranch, agent: command.agent, ui: 'gui', autoArchive: true }
  } else {
    action = { kind: 'send', sessionId: caller.session.id }
  }
  // Checked as main will check it when the user says 开始, so the agent hears now what would not be kept.
  const draft = parseDraft({ name: name.replace(/\s+/g, ' '), enabled: true, action, prompt: command.text, timing, missed: 'skip' } satisfies ScheduleDraft)
  if (!draft) return waviFail('invalid_request', 'Wavi cannot keep that task: the message is at most 8000 characters, --every a whole number of minutes from 10m to 7 days.')
  useScheduleRequests.setState((s) => ({ pending: [...s.pending, { callId: call.callId, sessionId: caller.session.id, draft, expiresAt: now + AGENT_SCHEDULE_TTL_MS }] }))
  if (!document.hasFocus()) window.tr.ui.notify({ title: `「${caller.session.title}」想建 1 个定时任务`, body: '在 Wavi 里确认要不要开始。', tag: caller.session.id })
  return waviOk(`The task "${name}" (${timingLabel(timing)}) waits for the user's 开始 in Wavi. wavi does not wait: end your turn now. Wavi sends you a message when the user decides.`)
}

function list(caller: Place): WaviResult {
  const mine = useSchedules.getState().schedules.filter((s) => s.createdBy?.sessionId === caller.session.id)
  if (mine.length === 0) return waviOk('You have no scheduled tasks.')
  return waviOk(
    mine
      .map((s) => {
        const last = s.runs[0]
        const to = s.action.kind === 'send' ? 'to this session' : `a new ${agentName(s.action.agent)} session`
        const until = s.expiresAt !== undefined ? `, until ${monthDay(s.expiresAt)}` : ''
        return `${s.id}  ${s.name} · ${timingLabel(s.timing)} · ${to}${until} · ${s.enabled ? 'on' : 'off'}${last ? ` · last: ${runLabel(last)}` : ''}`
      })
      .join('\n')
  )
}

async function remove(caller: Place, id: string): Promise<WaviResult> {
  const task = useSchedules.getState().schedules.find((s) => s.id === id)
  if (!task || task.createdBy?.sessionId !== caller.session.id) return waviFail('not_found', 'No scheduled task of yours has that id (wavi schedules lists them).')
  await window.tr.schedules.remove(id)
  return waviOk(`Removed "${task.name}".`)
}

/** The 定时任务 commands of `wavi` (dispatch/handler.ts hands them here). */
export function handleScheduleCommand(caller: Place, call: DispatchRequest, command: ScheduleCommand): Promise<WaviResult> | WaviResult {
  switch (command.name) {
    case 'schedule':
      return request(caller, call, command)
    case 'schedules':
      return list(caller)
    case 'unschedule':
      return remove(caller, command.id)
  }
}

/** 开始 / 拒绝 on the strip: every request this session has waiting. */
export async function decideScheduleRequests(sessionId: SessionId, go: boolean, session: Parameters<typeof deliverMessage>[0] | undefined): Promise<void> {
  const taken = useScheduleRequests.getState().pending.filter((r) => r.sessionId === sessionId)
  if (taken.length === 0) return
  useScheduleRequests.setState((s) => ({ pending: s.pending.filter((r) => r.sessionId !== sessionId) }))
  const made: string[] = []
  const refused: string[] = []
  if (go) {
    for (const r of taken) {
      const task = await window.tr.schedules.create(r.draft, sessionId).catch(() => null)
      if (task) made.push(`${task.id} "${task.name}" (${timingLabel(task.timing)})`)
      else refused.push(`"${r.draft.name}"`)
    }
  }
  if (!session) return
  const started = made.length > 0 ? `The user started ${made.length === 1 ? 'your scheduled task' : 'your scheduled tasks'}: ${made.join('; ')}. It lasts 7 days unless the user keeps it.` : ''
  const failed = refused.length > 0 ? ` Wavi could not keep ${refused.join(', ')} (设置 · 自动化 · 让 agent 建定时任务 may be off).` : ''
  const text = go
    ? `[Wavi] ${started}${failed} End your turn: Wavi sends the message at each time.`.replace('[Wavi]  ', '[Wavi] ')
    : `[Wavi] The user declined your scheduled task${taken.length > 1 ? 's' : ''}. Do not ask again unless the user asks.`
  void deliverMessage(session, text, { key: `schedule:${taken[0]!.callId}`, title: '定时任务' })
}

