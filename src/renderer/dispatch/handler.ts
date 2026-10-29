// What a window does when an agent calls a dispatch tool (PRD F21). The calling session is known from its hook
// environment; every target must be a session it started. Starting sessions waits for the user's 开始 in the
// confirmation strip under its terminal (PRD §2) unless 设置 · 自动化 · 派活 says otherwise; children start in new
// worktrees off the dispatcher's branch with Wavi's brief as their first message, given on the command line (§6.14).
import { diffSummary, diffSummaryText } from '@shared/attempt-groups'
import {
  ackReport,
  childBrief,
  DISPATCH_AGENTS,
  DISPATCH_LIMITS,
  DISPATCH_TOOL,
  messagePage,
  parseStartArgs,
  planChildren,
  startRefusal,
  toolFail,
  toolOk,
  type ChildPlan,
  type DispatchAgent,
  type DispatchHello,
  type DispatchRequest,
  type DispatchToolResult
} from '@shared/dispatch'
import { DEFAULT_SETTINGS, type DispatchSettings } from '@shared/settings'
import { checksText, turnCheckView } from '@shared/turn-checks'
import type { Project, Session, SessionId, Worktree } from '@shared/types'
import { markFor, useRadar } from '../conflict-radar/store'
import { createWorktreeFor, holdForWorktree, startEagerly } from '../new-session/creation'
import { interruptAgent } from '../session-io'
import { useSessionMeta } from '../session-meta/store'
import { useWorkspace } from '../state/workspace'
import { deliverTo } from './reports'
import { addConfirm, queueOf, setLaunch, setQueue, settleConfirm, useDispatch } from './store'

let settings: DispatchSettings = DEFAULT_SETTINGS.dispatch

export function setDispatchSettings(next: DispatchSettings): void {
  settings = next
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

interface Place {
  session: Session
  worktree: Worktree
  project: Project
}

function placeOf(id: SessionId): Place | null {
  const state = useWorkspace.getState()
  const session = state.sessions.find((s) => s.id === id)
  const worktree = session && state.worktrees.find((w) => w.id === session.worktreeId)
  const project = worktree && state.projects.find((p) => p.id === worktree.projectId)
  return session && worktree && project ? { session, worktree, project } : null
}

/** The sessions this one dispatched, listed ones first (an archived child is still its child). */
export function childrenOf(parentId: SessionId): Place[] {
  return useWorkspace
    .getState()
    .sessions.filter((s) => s.dispatchedBy === parentId)
    .flatMap((s) => placeOf(s.id) ?? [])
}

const isOpen = (place: Place): boolean => !place.worktree.archived

async function installedAgents(): Promise<DispatchAgent[]> {
  const found = await window.tr.app.detectAgents()
  return (Object.keys(DISPATCH_AGENTS) as DispatchAgent[]).filter((kind) => found[kind])
}

export async function handleDispatchRequest(request: DispatchRequest): Promise<DispatchToolResult | DispatchHello> {
  const caller = placeOf(request.sessionId)
  if (request.tool === 'hello') {
    const tools = settings.tools && !!caller && caller.session.kind !== 'shell' && caller.session.dispatchedBy === undefined
    return { tools, agents: tools ? await installedAgents() : [] }
  }
  if (!caller) return toolFail('not_found', 'Wavi does not know this session.')
  // The bridge takes cancels before they get here (cancelDispatchCall).
  if (request.tool === 'cancel') return toolFail('invalid_request', 'Nothing to answer for a cancel.')
  try {
    switch (request.tool) {
      case DISPATCH_TOOL.start:
        return await start(caller, request)
      case DISPATCH_TOOL.list:
        return await list(caller)
      case DISPATCH_TOOL.read:
        return await read(caller, request.args)
      case DISPATCH_TOOL.send:
        return await send(caller, request.args)
      case DISPATCH_TOOL.stop:
        return await stop(caller, request.args)
    }
  } catch (error) {
    return toolFail('failed', message(error))
  }
}

// --- start_sessions ------------------------------------------------------------------------------------------------

/** What the dispatcher's own checkout is on: its branch (the main checkout's current branch). */
async function baseOf(place: Place): Promise<string | null> {
  if (!place.worktree.isMain) return place.worktree.branch || null
  const info = await window.tr.gitWorktrees.newSessionInfo(place.project.rootPath)
  return info.currentBranch
}

async function hasUncommitted(place: Place): Promise<boolean> {
  try {
    const changes = await window.tr.git.changes(place.worktree.path)
    return (changes?.uncommitted.length ?? 0) > 0
  } catch {
    return false
  }
}

/** Calls their agent gave up (Esc) before or while they waited on the user; see `cancelDispatchCall`. */
const cancelledCalls = new Set<string>()

/** The agent cancelled a call (PRD F21 · §6.14): what it still waits on the user for goes away, as if declined. */
export function cancelDispatchCall(callId: string): void {
  cancelledCalls.add(callId)
  settleConfirm(callId, false)
}

function confirm(caller: Place, callId: string, plans: ChildPlan[], base: string, reason: string | undefined, uncommitted: boolean): Promise<'start' | 'declined' | 'timeout'> {
  // Cancelled while Wavi was still planning the batch: never show it.
  if (cancelledCalls.delete(callId)) return Promise.resolve('declined')
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      settleConfirm(callId, false)
      resolve('timeout')
    }, DISPATCH_LIMITS.confirmMs)
    addConfirm({
      callId,
      parentId: caller.session.id,
      plans,
      base,
      ...(reason ? { reason } : {}),
      uncommitted,
      decide: (go) => {
        window.clearTimeout(timer)
        resolve(go ? 'start' : 'declined')
      }
    })
    if (!document.hasFocus()) {
      window.tr.ui.notify({ title: `「${caller.session.title}」想开 ${plans.length} 个会话`, body: '在 Wavi 里确认要不要开始。', tag: caller.session.id })
    }
  })
}

async function start(caller: Place, request: DispatchRequest): Promise<DispatchToolResult> {
  if (caller.session.kind === 'shell') return toolFail('not_allowed', 'Only agent sessions can start sessions.')
  const parsed = parseStartArgs(request.args, await installedAgents())
  if (!parsed.ok) return parsed.result
  const open = childrenOf(caller.session.id).filter(isOpen)
  const refusal = startRefusal({
    isChild: caller.session.dispatchedBy !== undefined,
    toolsOn: settings.tools,
    openTasks: open.map((c) => c.session.dispatchTask ?? c.session.title),
    items: parsed.request.items
  })
  if (refusal) return refusal
  const info = await window.tr.gitWorktrees.newSessionInfo(caller.project.rootPath)
  if (!info.repo) return toolFail('not_allowed', 'This project is not a git repository, so Wavi cannot give new sessions their own worktrees.')
  const base = await baseOf(caller)
  if (!base) return toolFail('failed', "This session's checkout is not on a branch (detached HEAD); new worktrees need one to start from.")
  const plans = planChildren({
    items: parsed.request.items,
    root: caller.project.rootPath,
    base,
    prefix: info.prefix,
    branches: info.branches.map((b) => b.name),
    worktreesDir: info.worktreesDir,
    takenFolders: info.takenFolders,
    prepare: info.includeCount > 0 || info.hasSetup
  })
  const uncommitted = await hasUncommitted(caller)
  if (!settings.autoApprove) {
    const decision = await confirm(caller, request.callId, plans, base, parsed.request.reason, uncommitted)
    if (decision === 'declined') return toolFail('declined', 'The user declined to start these sessions. Do not retry unless the user asks; carry on yourself or ask them.')
    if (decision === 'timeout') return toolFail('timeout', 'The user did not answer within 10 minutes; nothing was started. Ask them before trying again.')
  }
  const ids = launch(caller, plans, base)
  const lines = plans.map((p, i) => `- id ${ids[i] ?? '(not started)'} · ${p.item.agent} · "${p.item.title}" · branch ${p.branch}`)
  return toolOk(
    [
      `Started ${ids.filter(Boolean).length} session(s) off ${base}${settings.autoApprove ? '' : ' (the user approved)'}:`,
      ...lines,
      ...(uncommitted ? ['Your uncommitted changes were not copied into them.'] : []),
      'They work on their own. Wavi will report to you when each finishes a turn, fails or exits: end your turn now instead of waiting.'
    ].join('\n')
  )
}

/** Adds the children to the workspace at once (sidebar, under the dispatcher) and creates their worktrees one by one. */
function launch(caller: Place, plans: readonly ChildPlan[], base: string): Array<SessionId | null> {
  const workspace = useWorkspace.getState()
  const ids = plans.map((plan) => {
    const id = workspace.addBackgroundSession(caller.project.id, { path: plan.path, branch: plan.branch, baseBranch: base }, plan.item.agent)
    if (!id) return null
    useWorkspace.getState().patchSession(id, { title: plan.item.title, titleSource: 'prompt', dispatchedBy: caller.session.id, dispatchTask: plan.item.task })
    const brief = childBrief({ task: plan.item.task, parentTitle: caller.session.title, parentAgent: caller.session.kind === 'codex' ? 'codex' : 'claude', branch: plan.branch, base })
    setLaunch(id, { initialPrompt: brief, ...(plan.item.model ? { model: plan.item.model } : {}) })
    holdForWorktree(id)
    startEagerly(id)
    return id
  })
  void (async () => {
    for (const [i, plan] of plans.entries()) {
      const id = ids[i]
      if (id) await createWorktreeFor(id, plan.item.agent, plan.request)
    }
  })()
  return ids
}

// --- the other tools -----------------------------------------------------------------------------------------------

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

export function checksOf(id: SessionId): string | undefined {
  const view = turnCheckView(useSessionMeta.getState().bySession[id]?.checks)
  return view ? checksText(view) : undefined
}

export function conflictsOf(place: Place): string | undefined {
  return markFor(useRadar.getState().byRoot[place.project.rootPath], place.worktree.path)?.label
}

async function list(caller: Place): Promise<DispatchToolResult> {
  const children = childrenOf(caller.session.id)
  if (children.length === 0) return toolOk('You have not started any sessions.')
  const rows = await Promise.all(
    children.map(async (c) => {
      const changes = await changesText(c)
      const conflicts = conflictsOf(c)
      const facts = [
        `id ${c.session.id}`,
        c.session.kind,
        `"${c.session.title}"`,
        c.worktree.archived ? 'archived by the user' : statusOf(c.session),
        `branch ${c.worktree.branch}`,
        changes.text,
        checksOf(c.session.id),
        conflicts
      ]
      const reply = c.session.lastReply ? `\n  last: ${c.session.lastReply}` : ''
      return { line: `- ${facts.filter(Boolean).join(' · ')}${reply}`, place: c, conflicts, size: changes.size }
    })
  )
  // Merge the work that conflicts with nothing first, smaller diffs before larger ones (the user merges, in Wavi).
  const order = rows
    .filter((r) => !r.place.worktree.archived)
    .sort((a, b) => Number(Boolean(a.conflicts)) - Number(Boolean(b.conflicts)) || a.size - b.size)
    .map((r) => r.place.worktree.branch)
  return toolOk([...rows.map((r) => r.line), '', `Suggested merge order (the user merges in Wavi): ${order.join(' → ') || 'none'}`].join('\n'))
}

function target(caller: Place, args: unknown): Place | DispatchToolResult {
  const id = typeof args === 'object' && args !== null ? (args as Record<string, unknown>).id : undefined
  if (typeof id !== 'string') return toolFail('invalid_request', 'Pass the id of a session you started.')
  const place = placeOf(id)
  if (!place || place.session.dispatchedBy !== caller.session.id) return toolFail('not_found', `No session with id ${id} was started by you. list_sessions shows yours.`)
  return place
}

const isPlace = (value: Place | DispatchToolResult): value is Place => 'session' in value

async function read(caller: Place, args: unknown): Promise<DispatchToolResult> {
  const child = target(caller, args)
  if (!isPlace(child)) return child
  const offset = Number((args as Record<string, unknown>).offset ?? 0)
  const whole = useDispatch.getState().messages[child.session.id] ?? child.session.lastReply ?? ''
  const page = messagePage(whole, Number.isInteger(offset) && offset >= 0 ? offset : 0)
  setQueue(caller.session.id, ackReport(queueOf(caller.session.id), child.session.id))
  const changes = await changesText(child)
  const head = [
    `"${child.session.title}" · ${child.session.kind} · ${statusOf(child.session)} · branch ${child.worktree.branch} (from ${child.worktree.baseBranch ?? '?'})`,
    `Changes: ${changes.text}${changes.files.length > 0 ? `\n${changes.files.slice(0, 60).map((f) => `  ${f}`).join('\n')}` : ''}`,
    ...(checksOf(child.session.id) ? [`Checks this turn: ${checksOf(child.session.id)}`] : []),
    ...(conflictsOf(child) ? [`Conflicts: ${conflictsOf(child)}`] : [])
  ]
  const body = page.text
    ? `Last message${offset > 0 ? ` (from ${offset})` : ''}:\n${page.text}`
    : child.session.status === 'running' || child.session.phase === 'starting'
      ? 'No final message yet: it is still working.'
      : 'No final message: its turn ended without a reply, which usually means it failed (for example a model provider error). The reason is on its screen; ask the user to look.'
  const more = page.nextOffset !== null ? `\n[more: call read_result with offset ${page.nextOffset}]` : ''
  return toolOk(`${head.join('\n')}\n\n${body}${more}`)
}

async function send(caller: Place, args: unknown): Promise<DispatchToolResult> {
  const child = target(caller, args)
  if (!isPlace(child)) return child
  const text = (args as Record<string, unknown>).text
  if (typeof text !== 'string' || text.trim() === '') return toolFail('invalid_request', 'text is empty.')
  if (text.length > DISPATCH_LIMITS.message) return toolFail('invalid_request', `text is longer than ${DISPATCH_LIMITS.message} characters.`)
  if (child.worktree.archived || child.session.phase === 'exited' || child.session.status === 'exited') return toolFail('not_allowed', 'That session is archived or its agent has exited.')
  const framed = `（来自派活方「${caller.session.title}」的消息，不是用户的指示）\n${text.trim()}`
  const result = await deliverTo(child.session, framed)
  if (result === 'delivered') return toolOk('Sent. A busy agent reads it after its current step or turn; Wavi reports back when its turn ends.')
  return toolFail('failed', 'Wavi could not reach that agent without typing into its terminal (it may still be starting). Try again later, or ask the user.')
}

async function stop(caller: Place, args: unknown): Promise<DispatchToolResult> {
  const child = target(caller, args)
  if (!isPlace(child)) return child
  if (child.session.status !== 'running' && child.session.status !== 'needs_you') return toolOk('It was not working on anything.')
  await interruptAgent(child.session.id)
  return toolOk('Interrupted its current turn. The session and its work stay.')
}
