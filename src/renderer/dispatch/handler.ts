// What a window does when an agent runs `wavi` (PRD F21). The calling session is known from its WAVI_DIR; every
// target must be a session it started. `wavi run` answers at once: a session the user's own session starts waits for
// 开始 in the strip under its terminal (unless 设置 · 自动化 · 派活 says otherwise), and the user's answer reaches the
// agent later as a message; one a dispatched session starts begins right away. Children start in new worktrees — a
// branch off the dispatcher's, or a snapshot of its working tree — with Wavi's brief as their first message (§6.14).
import { CLI_AGENTS } from '@shared/agents'
import { diffSummary, diffSummaryText } from '@shared/attempt-groups'
import {
  ackReport,
  agentLabel,
  childBrief,
  childUi,
  DISPATCH_LIMITS,
  messagePage,
  noticeText,
  planChild,
  startRefusal,
  titleFor,
  waviFail,
  waviOk,
  type ChildPlan,
  type DispatchRequest,
  type StartedChild,
  type WaviCommand,
  type WaviResult
} from '@shared/dispatch'
import { DEFAULT_SETTINGS, type DispatchSettings } from '@shared/settings'
import type { Session, SessionId } from '@shared/types'
import { createWorktreeFor, holdForWorktree, startEagerly } from '../new-session/creation'
import { binaryInstalled } from '../new-session/model'
import { interruptAgent } from '../session-io'
import { useWorkspace } from '../state/workspace'
import { randomId } from '../state/workspace-model'
import { handleScheduleCommand } from '../schedules/agent-requests'
import { checksOf, childrenOf, conflictsOf, placeOf, type Place } from './places'
import { deliverMessage, queueReport } from './reports'
import { addConfirm, queueOf, setLaunch, setQueue, setReported, takeConfirms, useDispatch, type PendingStart } from './store'

let settings: DispatchSettings = DEFAULT_SETTINGS.dispatch

export function setDispatchSettings(next: DispatchSettings): void {
  settings = next
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const isOpen = (place: Place): boolean => !place.worktree.archived

/** 0 for the user's own session, 1 for one it dispatched, 2 below that. */
export function depthOf(session: Session): number {
  const sessions = useWorkspace.getState().sessions
  let depth = 0
  for (let at: Session | undefined = session; at?.dispatchedBy !== undefined && depth <= DISPATCH_LIMITS.depth; depth++) {
    at = sessions.find((s) => s.id === at?.dispatchedBy)
  }
  return depth
}

/** The open sessions under `topId`, at any depth. */
function treeOf(topId: SessionId): SessionId[] {
  const out: SessionId[] = []
  for (let level = [topId]; level.length > 0; ) {
    const next = childrenOf(level[0]!).filter(isOpen).map((c) => c.session.id)
    out.push(...next)
    level = [...level.slice(1), ...next]
  }
  return out
}

function topOf(session: Session): Session {
  const sessions = useWorkspace.getState().sessions
  let at = session
  for (let i = 0; i < DISPATCH_LIMITS.depth && at.dispatchedBy !== undefined; i++) at = sessions.find((s) => s.id === at.dispatchedBy) ?? at
  return at
}

/** `wavi run`s one at a time, so the limits and duplicate check see the requests before them (no check-then-act race). */
let runs: Promise<unknown> = Promise.resolve()

/** Past it, `wavi` has been told Wavi did not answer (the agent may retry): nothing more may be done for this call. */
const late = (request: DispatchRequest): boolean => Date.now() > request.deadline
const TOO_LATE = (): WaviResult => waviFail('wavi_unavailable', 'Wavi took too long; nothing was done. Try again in a moment.')

export async function handleWaviRequest(request: DispatchRequest): Promise<WaviResult> {
  const caller = placeOf(request.sessionId)
  if (!caller) return waviFail('not_found', 'Wavi does not know this session.')
  if (caller.session.kind === 'shell') return waviFail('not_allowed', 'Only agent sessions use wavi.')
  // Off means off for sessions that started while it was on, too (PRD F21 注入).
  if (!settings.tools) return waviFail('not_allowed', 'The user turned off dispatch in Wavi (设置 · 自动化 · 派活).')
  try {
    if (request.command.name !== 'run') return await run(caller, request)
    const turn = runs.then(() => (late(request) ? TOO_LATE() : run(placeOf(request.sessionId) ?? caller, request)))
    runs = turn.catch(() => {})
    return await turn
  } catch (error) {
    return waviFail('failed', message(error))
  }
}

function run(caller: Place, request: DispatchRequest): Promise<WaviResult> | WaviResult {
  const command = request.command
  switch (command.name) {
    case 'run':
      return start(caller, request, command)
    case 'ls':
      return list(caller)
    case 'read':
      return read(caller, command.id, command.offset)
    case 'send':
      return send(caller, command.id, command.text)
    case 'report':
      return report(caller, command.text)
    case 'stop':
      return stop(caller, command.id)
    case 'schedule':
    case 'schedules':
    case 'unschedule':
      return handleScheduleCommand(caller, request, command)
  }
}

// --- wavi run ------------------------------------------------------------------------------------------------------

async function hasUncommitted(place: Place): Promise<boolean> {
  try {
    const changes = await window.tr.git.changes(place.worktree.path)
    return (changes?.uncommitted.length ?? 0) > 0
  } catch {
    return false
  }
}

const where = (plan: ChildPlan): string =>
  `${plan.branch ? `branch ${plan.branch}` : 'a read-only snapshot of your working tree'}${plan.item.ui === 'gui' ? ', shown as a chat' : ''}`

/** Timers of requests waiting for 开始 (10 minutes, then they count as unanswered). */
const timers = new Map<string, number>()

async function start(caller: Place, request: DispatchRequest, command: Extract<WaviCommand, { name: 'run' }>): Promise<WaviResult> {
  const callId = request.callId
  const depth = depthOf(caller.session)
  const waiting = useDispatch.getState().confirms
  const top = topOf(caller.session)
  const tree = new Set([top.id, ...treeOf(top.id)])
  const refusal = startRefusal({
    depth,
    toolsOn: settings.tools,
    openTasks: [
      ...childrenOf(caller.session.id)
        .filter(isOpen)
        .map((c) => c.session.dispatchTask ?? c.session.title),
      ...waiting.filter((c) => c.parentId === caller.session.id).map((c) => c.plan.item.task)
    ],
    treeSize: tree.size - 1 + waiting.filter((c) => tree.has(c.parentId)).length,
    task: command.task
  })
  if (refusal) return refusal
  // In parallel: `wavi` waits 5 s for the whole answer (PRD F21 接口).
  const autoStart = settings.autoApprove || depth >= 1
  const [installed, info, uncommitted] = await Promise.all([
    window.tr.app.detectAgents(),
    window.tr.gitWorktrees.newSessionInfo(caller.project.rootPath),
    command.base === 'head' && !autoStart ? hasUncommitted(caller) : Promise.resolve(false)
  ])
  if (!installed[command.agent]) {
    // Only agent ids: the result also carries `adapters` (PRD F23).
    const names = CLI_AGENTS.filter((k) => installed[k] === true)
    return waviFail('agent_unavailable', `${agentLabel(command.agent)} is not installed here. Installed: ${names.join(', ') || 'none'}.`)
  }
  if (!info.repo) return waviFail('not_allowed', 'This project is not a git repository, so Wavi cannot give a new session its own worktree.')
  // What the dispatcher's checkout is on: its branch, or the main checkout's current branch.
  const base = caller.worktree.isMain ? info.currentBranch : caller.worktree.branch || null
  if (command.base === 'head' && !base) {
    return waviFail('failed', "Your checkout is not on a branch (detached HEAD), so there is nothing to branch from. Use --base snapshot, or ask the user.")
  }
  // A GUI dispatcher's children open as GUI too, when their agent can (PRD F21 v1.163); `--ui` decides otherwise.
  const ui = childUi({ agent: command.agent, ...(command.ui ? { requested: command.ui } : {}), parentUi: caller.session.ui ?? 'cli', installed: binaryInstalled(installed) })
  const note = ui.note ? ` ${ui.note}` : ''
  const plan = planChild({
    item: {
      agent: command.agent,
      task: command.task,
      title: titleFor(command.task, command.title),
      base: command.base,
      ...(command.model ? { model: command.model } : {}),
      ...(ui.ui === 'gui' ? { ui: 'gui' as const } : {})
    },
    root: caller.project.rootPath,
    base: base ?? 'HEAD',
    from: caller.worktree.path,
    prefix: info.prefix,
    // Requests still waiting, and sessions whose worktree is still being made, have names of their own already.
    branches: [...info.branches.map((b) => b.name), ...waiting.map((c) => c.plan.branch), ...useWorkspace.getState().worktrees.map((w) => w.branch)].filter(Boolean),
    worktreesDir: info.worktreesDir,
    takenFolders: [...info.takenFolders, ...waiting.map((c) => c.plan.request.folder), ...useWorkspace.getState().worktrees.map((w) => w.path.split('/').pop() ?? '')].filter(Boolean),
    prepare: info.includeCount > 0 || info.hasSetup
  })
  const childId = randomId('s')
  const model = command.model ? ` · ${command.model}` : ''
  if (late(request)) return TOO_LATE()
  // Sessions a dispatched session starts begin at once, within the limits (only the first level is confirmed).
  if (autoStart) {
    const started = launch(caller, plan, childId, base ?? 'HEAD', depth + 1)
    if (!started) return waviFail('failed', 'Wavi could not add the session.')
    return waviOk(
      `Started session ${started.id} (${command.agent}${model}, ${where(plan)}).${note} It works on its own: Wavi sends you its report when it finishes a turn, fails or exits. End your turn now instead of waiting.`
    )
  }
  addConfirm({ callId, parentId: caller.session.id, childId, plan, base: base ?? 'HEAD', uncommitted })
  timers.set(
    callId,
    window.setTimeout(() => decide([callId], 'timeout'), DISPATCH_LIMITS.confirmMs)
  )
  if (!document.hasFocus()) {
    const count = useDispatch.getState().confirms.filter((c) => c.parentId === caller.session.id).length
    window.tr.ui.notify({ title: `「${caller.session.title}」想开 ${count} 个会话`, body: '在 Wavi 里确认要不要开始。', tag: caller.session.id })
  }
  return waviOk(
    [
      `Session ${childId} (${command.agent}${model}, ${where(plan)}) waits for the user's 开始 in Wavi.${note}${uncommitted ? ' Your uncommitted changes will not be in it.' : ''}`,
      'wavi does not wait: end your turn now. Wavi sends you a message when the user decides, and a report when the session finishes a turn, fails or exits.'
    ].join('\n')
  )
}

/** Requests taken up from a saved workspace get their time to be answered again (the old timers went with the window). */
export function resumeConfirmTimers(): void {
  for (const { callId } of useDispatch.getState().confirms) {
    if (timers.has(callId)) continue
    timers.set(
      callId,
      window.setTimeout(() => decide([callId], 'timeout'), DISPATCH_LIMITS.confirmMs)
    )
  }
}

/** The user answered the strip under a dispatcher's terminal (开始 / 拒绝 / ⌘↵): every request it shows. */
export function decideConfirms(parentId: SessionId, go: boolean): void {
  decide(
    useDispatch
      .getState()
      .confirms.filter((c) => c.parentId === parentId)
      .map((c) => c.callId),
    go ? 'started' : 'declined'
  )
}

/** The user answered these requests only (a GUI dispatcher's graph, Figma 68′): what the button counted is what starts. */
export function decideCalls(callIds: readonly string[], go: boolean): void {
  decide(callIds, go ? 'started' : 'declined')
}

/** The dispatcher's agent went away (PRD F21 确认): what it asked for goes too, with nobody to tell. */
export function dropConfirmsOf(parentId: SessionId): void {
  for (const c of takeConfirms(useDispatch.getState().confirms.filter((p) => p.parentId === parentId).map((p) => p.callId))) {
    window.clearTimeout(timers.get(c.callId))
    timers.delete(c.callId)
  }
}

function decide(callIds: readonly string[], outcome: 'started' | 'declined' | 'timeout'): void {
  const taken = takeConfirms(callIds)
  const byParent = new Map<SessionId, PendingStart[]>()
  for (const c of taken) {
    window.clearTimeout(timers.get(c.callId))
    timers.delete(c.callId)
    byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c])
  }
  for (const [parentId, confirms] of byParent) {
    const parent = placeOf(parentId)
    if (!parent) continue
    const children: StartedChild[] = confirms.flatMap((c) => {
      if (outcome !== 'started') return [{ id: c.childId, agent: c.plan.item.agent, title: c.plan.item.title, branch: c.plan.branch }]
      const started = launch(parent, c.plan, c.childId, c.base, depthOf(parent.session) + 1)
      return started ? [started] : []
    })
    void deliverMessage(parent.session, noticeText(outcome, children), { key: `notice:${confirms[0]!.callId}`, title: '派活结果' })
  }
}

/** Adds the child to the workspace at once (sidebar, under the dispatcher) and creates its worktree in the background. */
function launch(caller: Place, plan: ChildPlan, childId: SessionId, base: string, depth: number): StartedChild | null {
  const snapshot = plan.item.base === 'snapshot'
  const workspace = useWorkspace.getState()
  const target = { path: plan.path, branch: plan.branch, ...(snapshot ? {} : { baseBranch: base }) }
  const id = workspace.addBackgroundSession(caller.project.id, target, plan.item.agent, childId, plan.item.ui ?? 'cli')
  if (!id) return null
  useWorkspace.getState().patchSession(id, {
    title: plan.item.title,
    titleSource: 'prompt',
    dispatchedBy: caller.session.id,
    dispatchTask: plan.item.task,
    ...(snapshot ? { dispatchBase: 'snapshot' as const } : {}),
    ...(plan.item.model ? { dispatchModel: plan.item.model } : {})
  })
  const parentAgent = caller.session.kind === 'shell' ? 'claude' : caller.session.kind
  const brief = childBrief({ task: plan.item.task, parentTitle: caller.session.title, parentAgent, depth, branch: plan.branch, base, snapshot })
  setLaunch(id, { initialPrompt: brief, ...(plan.item.model ? { model: plan.item.model } : {}) })
  holdForWorktree(id)
  startEagerly(id)
  void createWorktreeFor(id, plan.item.agent, plan.request)
  return { id, agent: plan.item.agent, title: plan.item.title, branch: plan.branch }
}

// --- the other commands --------------------------------------------------------------------------------------------

const STATUS_TEXT: Record<Session['status'], string> = {
  running: 'running',
  needs_you: 'waiting for the user (a permission or question in its terminal)',
  done_unread: 'finished a turn',
  idle: 'idle',
  error: 'error',
  exited: 'exited'
}

function statusOf(session: Session): string {
  if (session.phase === 'starting') return 'starting'
  if (session.phase === 'exited') return 'agent exited'
  return STATUS_TEXT[session.status]
}

const placeText = (place: Place): string => (place.session.dispatchBase === 'snapshot' ? 'snapshot' : `branch ${place.worktree.branch}`)

async function changesText(place: Place): Promise<{ text: string; files: string[]; size: number }> {
  try {
    const changes = await window.tr.git.changes(place.worktree.path, place.worktree.baseBranch)
    if (!changes) return { text: 'unknown', files: [], size: 0 }
    const summary = diffSummary(changes)
    const files = [...new Set([...changes.committed, ...changes.uncommitted].map((f) => f.path))]
    return { text: diffSummaryText(summary), files, size: summary.added + summary.removed }
  } catch {
    return { text: 'unknown', files: [], size: 0 }
  }
}

async function list(caller: Place): Promise<WaviResult> {
  const children = childrenOf(caller.session.id)
  const waiting = useDispatch.getState().confirms.filter((c) => c.parentId === caller.session.id)
  if (children.length === 0 && waiting.length === 0) return waviOk('You have not started any sessions.')
  const rows = await Promise.all(
    children.map(async (c) => {
      const changes = await changesText(c)
      const conflicts = conflictsOf(c)
      const facts = [
        `id ${c.session.id}`,
        c.session.kind,
        c.session.dispatchModel,
        `"${c.session.title}"`,
        c.worktree.archived ? 'archived by the user' : statusOf(c.session),
        placeText(c),
        changes.text,
        checksOf(c.session.id),
        conflicts
      ]
      const reply = c.session.lastReply ? `\n  last: ${c.session.lastReply}` : ''
      return { line: `- ${facts.filter(Boolean).join(' · ')}${reply}`, place: c, conflicts, size: changes.size }
    })
  )
  const pending = waiting.map((c) => `- id ${c.childId} · ${c.plan.item.agent} · "${c.plan.item.title}" · waiting for the user's 开始`)
  // Merge the work that conflicts with nothing first, smaller diffs before larger ones (the user merges, in Wavi).
  const order = rows
    .filter((r) => !r.place.worktree.archived && r.place.session.dispatchBase !== 'snapshot')
    .sort((a, b) => Number(Boolean(a.conflicts)) - Number(Boolean(b.conflicts)) || a.size - b.size)
    .map((r) => r.place.worktree.branch)
  return waviOk([...rows.map((r) => r.line), ...pending, '', `Suggested merge order (the user merges in Wavi): ${order.join(' → ') || 'none'}`].join('\n'))
}

function target(caller: Place, id: string): Place | WaviResult {
  const place = placeOf(id)
  if (!place || place.session.dispatchedBy !== caller.session.id) {
    const waiting = useDispatch.getState().confirms.some((c) => c.parentId === caller.session.id && c.childId === id)
    return waviFail('not_found', waiting ? `Session ${id} has not started yet: it waits for the user's 开始.` : `No session with id ${id} was started by you. wavi ls shows yours.`)
  }
  return place
}

const isPlace = (value: Place | WaviResult): value is Place => 'session' in value

async function read(caller: Place, id: string, offset: number): Promise<WaviResult> {
  const child = target(caller, id)
  if (!isPlace(child)) return child
  const whole = useDispatch.getState().messages[child.session.id] ?? child.session.lastReply ?? ''
  const page = messagePage(whole, offset)
  setQueue(caller.session.id, ackReport(queueOf(caller.session.id), child.session.id))
  const changes = await changesText(child)
  const head = [
    `"${child.session.title}" · ${child.session.kind}${child.session.dispatchModel ? ` · ${child.session.dispatchModel}` : ''} · ${statusOf(child.session)} · ${placeText(child)}${child.worktree.baseBranch ? ` (from ${child.worktree.baseBranch})` : ''}`,
    `Changes: ${changes.text}${changes.files.length > 0 ? `\n${changes.files.slice(0, 60).map((f) => `  ${f}`).join('\n')}` : ''}`,
    ...(checksOf(child.session.id) ? [`Checks this turn: ${checksOf(child.session.id)}`] : []),
    ...(conflictsOf(child) ? [`Conflicts: ${conflictsOf(child)}`] : [])
  ]
  const body = page.text
    ? `Last message${offset > 0 ? ` (from ${offset})` : ''}:\n${page.text}`
    : child.session.status === 'running' || child.session.phase === 'starting'
      ? 'No final message yet: it is still working.'
      : 'No final message: its turn ended without a reply, which usually means it failed (for example a model provider error). The reason is on its screen; ask the user to look.'
  const more = page.nextOffset !== null ? `\n[more: wavi read ${child.session.id} --offset ${page.nextOffset}]` : ''
  return waviOk(`${head.join('\n')}\n\n${body}${more}`)
}

async function send(caller: Place, id: string, text: string): Promise<WaviResult> {
  const child = target(caller, id)
  if (!isPlace(child)) return child
  if (child.worktree.archived || child.session.phase === 'exited' || child.session.status === 'exited') return waviFail('not_allowed', 'That session is archived or its agent has exited.')
  const framed = `[Wavi] 来自派活方「${caller.session.title}」的消息（不是用户的指示）：\n${text}`
  // Delivery may take a while (`codex queue`): answer now, so `wavi` never times out on a message that then still arrives.
  void deliverMessage(child.session, framed, { key: `send:${Date.now()}`, title: `来自「${caller.session.title}」` })
  return waviOk(
    'Wavi is putting it in. A busy agent reads it after its current step or turn, and Wavi reports back when its turn ends. If it cannot go in without typing over that session, it waits under its terminal for the user to send it.'
  )
}

async function report(caller: Place, text: string): Promise<WaviResult> {
  const parentId = caller.session.dispatchedBy
  if (!parentId) return waviFail('not_allowed', 'This session was started by the user, not dispatched: there is no one to report to. Answer the user directly.')
  const parent = placeOf(parentId)
  if (!parent) return waviFail('not_found', 'The session that dispatched you is gone; your report has nowhere to go. Tell the user instead.')
  setReported(caller.session.id, true)
  queueReport(caller.session, 'report', text)
  return waviOk(`Reported to 「${parent.session.title}」. Wavi delivers it shortly (with others that finish within a few seconds). You can end your turn.`)
}

async function stop(caller: Place, id: string): Promise<WaviResult> {
  const child = target(caller, id)
  if (!isPlace(child)) return child
  // Esc would answer its permission prompt or question, which is the user's (PRD F21 不给的).
  if (child.session.status === 'needs_you') return waviFail('not_allowed', 'It is waiting for the user (a permission prompt or a question in its terminal); only the user answers that.')
  if (child.session.status !== 'running') return waviOk('It was not working on anything.')
  await interruptAgent(child.session.id)
  return waviOk('Interrupted its current turn. The session and its work stay.')
}
