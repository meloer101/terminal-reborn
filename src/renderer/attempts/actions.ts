// 一题多解 (PRD F4 / F9 v1.59): what 创建 N 个并发送 does, and what the group offers afterwards. The sheet closes at
// once and every member appears in the sidebar; the overview opens with the members side by side. In the background
// the worktrees are created one after another (git locks the repository's config and refs), each member's agent
// starts as soon as its folder is there — shown or not — and the prompt is typed and submitted once that agent is up
// (PRD §6.9). The user asked for exactly this by pressing the button, whose text says what is sent to whom (§2).
import { groupOfSession, remainingMembers, type AttemptGroup, type AttemptMemberPlan } from '@shared/attempt-groups'
import type { ProjectId, SessionId } from '@shared/types'
import { archiveTargetFor, archiveWorktree } from '../archive/actions'
import { createWorktreeFor, holdForWorktree, startEagerly } from '../new-session/creation'
import { setTab } from '../panels/git/store'
import { openMergeSheet, targetFor } from '../panels/merge/store'
import { enterSession, showCompare, useOverviewStore } from '../overview/store'
import { submitPrompt, whenAgentReady } from '../session-io'
import { addAttemptGroup, newGroupId, setMemberLaunch, useAttemptGroups } from '../state/attempt-groups'
import { useWorkspace } from '../state/workspace'
import { titleFromFirstPrompt } from '../state/workspace-model'

/** A new worktree's agent may first ask to trust the folder; the user answers in its terminal meanwhile. */
const READY_TIMEOUT_MS = 5 * 60_000

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Adds the members, opens the overview on them and starts the launch. Returns the group's id. */
export function runAttemptPlan(projectId: ProjectId, base: string, prompt: string, members: readonly AttemptMemberPlan[]): string | null {
  const ids: SessionId[] = []
  for (const member of members) {
    const id = useWorkspace
      .getState()
      .addBackgroundSession(projectId, { path: member.path, branch: member.request.branch, baseBranch: member.request.base }, member.kind)
    if (!id) continue
    // Every member is named after the task right away, like a session after its first prompt (PRD F2).
    const session = useWorkspace.getState().sessions.find((s) => s.id === id)
    const title = session && titleFromFirstPrompt(session, prompt)
    if (title) useWorkspace.getState().patchSession(id, { title, titleSource: 'prompt' })
    // Held until its own worktree exists: they are created one after another.
    holdForWorktree(id)
    setMemberLaunch(id, { phase: 'creating' })
    startEagerly(id)
    ids.push(id)
  }
  if (ids.length === 0) return null
  const group: AttemptGroup = { id: newGroupId(), prompt, base, createdAt: Date.now(), members: ids }
  addAttemptGroup(group)
  showCompare(group.id, ids)
  void (async () => {
    for (const [i, id] of ids.entries()) {
      const member = members[i]!
      const created = await createWorktreeFor(id, member.kind, member.request)
      if (created) void deliver(id, prompt)
      else setMemberLaunch(id, { phase: 'failed', message: '没能创建 worktree，没有发送' })
    }
  })()
  return group.id
}

/** Waits for the member's agent, then types the prompt and presses Enter. */
async function deliver(id: SessionId, prompt: string): Promise<void> {
  setMemberLaunch(id, { phase: 'starting' })
  try {
    await whenAgentReady(id, READY_TIMEOUT_MS)
    setMemberLaunch(id, { phase: 'sending' })
    await submitPrompt(id, prompt)
    setMemberLaunch(id, { phase: 'sent' })
  } catch (error) {
    setMemberLaunch(id, { phase: 'failed', message: message(error) })
  }
}

/** 再发一次 after a failed send: the group's prompt again, to this member only. */
export function resend(id: SessionId): void {
  const group = groupOfSession(useAttemptGroups.getState().groups, id)
  if (group) void deliver(id, group.prompt)
}

/** 看 diff: the member's session with Git · 变更 open (PRD F5). */
export function openMemberDiff(id: SessionId): void {
  const state = useWorkspace.getState()
  const session = state.sessions.find((s) => s.id === id)
  const worktree = session && state.worktrees.find((w) => w.id === session.worktreeId)
  if (!worktree) return
  enterSession(id)
  setTab(worktree.path, 'changes')
  useWorkspace.getState().setRightPanel('git')
}

/** 合并这个: the merge sheet for the member's worktree (PRD F4); the overlay gives its terminals back first. */
export function mergeMember(id: SessionId): void {
  const state = useWorkspace.getState()
  const session = state.sessions.find((s) => s.id === id)
  const worktree = session && state.worktrees.find((w) => w.id === session.worktreeId)
  const project = worktree && state.projects.find((p) => p.id === worktree.projectId)
  if (!worktree || !project) return
  useOverviewStore.getState().openOverlay(null)
  openMergeSheet(targetFor(project.rootPath, worktree))
}

/** Listed in the sidebar: the session exists and its worktree is not archived. */
export function isListed(id: SessionId): boolean {
  const state = useWorkspace.getState()
  const session = state.sessions.find((s) => s.id === id)
  return session !== undefined && !state.worktrees.find((w) => w.id === session.worktreeId)?.archived
}

/** The branches of the members still to decide about (the confirmation and the button name them). */
export function remainingBranches(group: AttemptGroup): Array<{ id: SessionId; branch: string }> {
  const state = useWorkspace.getState()
  return remainingMembers(group, isListed).map((id) => {
    const session = state.sessions.find((s) => s.id === id)
    return { id, branch: state.worktrees.find((w) => w.id === session?.worktreeId)?.branch ?? id }
  })
}

/**
 * 归档其余 N 份 (PRD F15): asks first, naming every branch, then archives the members one by one (stop the agent, the
 * repository's archive script after its usual approval, a private ref with the work). Never without the confirmation.
 * Resolves to one line per member that could not be archived (an agent still running, a failed snapshot).
 */
export async function archiveRemaining(group: AttemptGroup): Promise<{ confirmed: boolean; failures: string[] }> {
  const left = remainingBranches(group)
  if (left.length === 0) return { confirmed: false, failures: [] }
  const ok = await window.tr.ui.confirm({
    message: `归档一题多解剩下的 ${left.length} 份？`,
    detail: `${left.map((m) => m.branch).join('、')}\n停止它们的 agent，存下工作区（含未提交的改动）后从列表里收起；可以在跳转（⌘K）的历史里恢复。`.slice(0, 480),
    confirmLabel: `归档 ${left.length} 份`,
    cancelLabel: '取消'
  })
  if (!ok) return { confirmed: false, failures: [] }
  const failures: string[] = []
  for (const { id, branch } of left) {
    const session = useWorkspace.getState().sessions.find((s) => s.id === id)
    const target = session ? archiveTargetFor(session.worktreeId) : null
    if (!target) continue
    const result = await archiveWorktree(target, { ignoreScriptFailure: true }).catch((error: unknown) => ({ ok: false as const, message: message(error) }))
    if (!result.ok) failures.push(`${branch}：${result.message}`)
  }
  return { confirmed: true, failures }
}

/** The attempt group a merge sheet's worktree belongs to (read when it opens: removing the worktree closes its session). */
export function attemptForWorktrees(worktreeIds: readonly string[]): { groupId: string; sessionId: SessionId } | null {
  const { sessions } = useWorkspace.getState()
  for (const session of sessions) {
    if (!worktreeIds.includes(session.worktreeId)) continue
    const group = groupOfSession(useAttemptGroups.getState().groups, session.id)
    if (group) return { groupId: group.id, sessionId: session.id }
  }
  return null
}
