// Git · 变更's exits and 归档 for the phone (PRD F22, Figma 45I / 45J): the same plan, run and archive as the desktop's
// buttons (pull-requests/exit-model.ts, ship-runner.ts, archive/actions.ts). The run's progress reaches the phone with the
// session list (model.ts `remoteShip`).
import { remoteFail, type RemoteExit, type RemoteExits, type RemoteResult, type RemoteShipAction } from '@shared/remote'
import type { ShipPreflight } from '@shared/ship'
import { checksText, turnCheckView } from '@shared/turn-checks'
import type { Project, Session, Worktree } from '@shared/types'
import { archiveTargetFor, archiveWorktree, blockerFor } from '../archive/actions'
import { commentTarget } from '../panels/git/comments'
import { exitPlan, shipContextFor, type ExitPlan, type ShipExit } from '../pull-requests/exit-model'
import { cancelShip, editShip, handConflictsToAgent, readRemembered, retryShip, startShip, submitShip, switchToPr, useShips } from '../pull-requests/ship-runner'
import { submitBlocker } from '../pull-requests/ship-flow'
import { useBaseCi } from '../pull-requests/base-ci'
import { usePullRequests } from '../pull-requests/store'
import { useSessionMeta } from '../session-meta/store'
import { useWorkspace } from '../state/workspace'
import { hidePaths } from './model'

interface Place {
  session: Session
  worktree: Worktree
  project: Project
}

function placeOf(sessionId: string): Place | null {
  const state = useWorkspace.getState()
  const session = state.sessions.find((s) => s.id === sessionId)
  const worktree = session && state.worktrees.find((w) => w.id === session.worktreeId)
  const project = worktree && state.projects.find((p) => p.id === worktree.projectId)
  return session && worktree && project && !worktree.archived ? { session, worktree, project } : null
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** A refusal for the phone, without the Mac's folders in it. */
const fail = (place: Place, message: string): RemoteResult => remoteFail(hidePaths(message, [place.worktree.path, place.project.rootPath]))

/** Git · 变更 swaps the exits for a stopped 自动修复's decision (PrRows.tsx `useStoppedFix`); the phone waits for it too. */
function stoppedFix(worktreePath: string, prNumber: number | null): boolean {
  const pr = usePullRequests.getState().automation[worktreePath]
  const base = useBaseCi.getState().automation[worktreePath]
  return (pr !== undefined && prNumber !== null && pr.number === prNumber && pr.run?.kind === 'stopped') || base?.run?.kind === 'stopped'
}
const STOPPED = '自动修复停下了，在 Mac 上回答后才能用出口'

/** What Git · 变更 would read: the changes, the preflight and the PR, then the plan. */
async function planFor(place: Place) {
  const { worktree, project } = place
  // Git · 变更 asks about the branch's PR when it opens; so does the phone.
  window.tr.pr.refresh(worktree.path)
  const changes = await window.tr.git.changes(worktree.path, worktree.baseBranch ?? undefined)
  if (!changes) return null
  const preflight: ShipPreflight = await window.tr.ship
    .preflight({ root: project.rootPath, worktree: worktree.path })
    .catch((error: unknown) => ({ ok: false, message: errorText(error) }))
  const pr = usePullRequests.getState()
  const prStatus = pr.gh === 'ready' ? (pr.byWorktree[worktree.path] ?? null) : null
  const plan = exitPlan({ preflight, remembered: readRemembered(project.rootPath), prStatus, changes, isMain: worktree.isMain, projectRoot: project.rootPath })
  return { changes, preflight, plan }
}

function phoneExit(place: Place, exit: ShipExit, plan: ExitPlan, stopped: boolean): RemoteExit {
  const url = exit.kind === 'open-pr' ? plan.pr?.url : undefined
  const blocker = stopped ? STOPPED : (plan.blocker(exit) ?? (exit.kind === 'open-pr' && !url ? '正在读取 PR…' : null))
  return { kind: exit.kind, label: exit.label, blocker: blocker ? hidePaths(blocker, [place.worktree.path, place.project.rootPath]) : null, ...(url ? { url } : {}) }
}

async function archiveBlocker(place: Place): Promise<string | null> {
  const target = archiveTargetFor(place.worktree.id)
  if (!target) return '找不到这个 worktree'
  const blocker = blockerFor(target)
  if (blocker) return blocker
  // The archive script's approval is a dialog on the Mac, which nobody may be in front of.
  const info = await window.tr.repoScripts.get(target.worktreePath).catch(() => null)
  return info?.scripts.archive !== undefined && !info.approved ? '这个仓库的 archive 脚本要先在 Mac 上批准一次' : null
}

export async function remoteExits(sessionId: string): Promise<RemoteResult> {
  const place = placeOf(sessionId)
  if (!place) return remoteFail('会话不存在')
  const found = await planFor(place)
  if (!found) return remoteFail('不是 git 仓库')
  const { preflight, plan } = found
  const { primary, secondary } = plan.exits
  const stopped = stoppedFix(place.worktree.path, plan.pr?.number ?? null)
  const open: ShipExit | null = plan.idlePr ? { kind: 'open-pr', number: plan.idlePr.number, label: `打开 PR #${plan.idlePr.number}`, blocker: null } : null
  const exits: RemoteExits = {
    // Opening the PR is never held up by a stopped fix.
    primary: plan.nothingToShip ? null : open ? phoneExit(place, open, plan, false) : phoneExit(place, primary, plan, stopped),
    secondary: plan.nothingToShip || plan.idlePr || !secondary ? null : phoneExit(place, secondary, plan, stopped),
    pr: plan.pr ? { number: plan.pr.number, state: plan.pr.state, url: plan.pr.url } : null,
    base: preflight.ok ? preflight.base : found.changes.base,
    baseProtected: preflight.ok ? preflight.baseProtected : null,
    archive: { blocker: await archiveBlocker(place) }
  }
  return { ok: true, data: exits }
}

async function start(place: Place, kind: 'main' | 'pr' | 'push-pr'): Promise<RemoteResult> {
  const found = await planFor(place)
  if (!found) return remoteFail('不是 git 仓库')
  const { changes, preflight, plan } = found
  const exit = [plan.exits.primary, plan.exits.secondary].find((e) => e?.kind === kind)
  if (!exit || plan.nothingToShip) return remoteFail('这个出口现在不能用')
  if (useShips.getState().byWorktree[place.worktree.path]) return remoteFail('这个 worktree 已经有一个出口在进行')
  if (stoppedFix(place.worktree.path, plan.pr?.number ?? null)) return remoteFail(STOPPED)
  const blocker = plan.blocker(exit)
  if (blocker || !preflight.ok) return fail(place, blocker ?? '正在检查…')
  const { session, worktree, project } = place
  const state = useWorkspace.getState()
  const agent = commentTarget(worktree, state.sessions, state.worktrees, session.id)
  const checks = turnCheckView(agent ? useSessionMeta.getState().bySession[agent.id]?.checks : undefined)
  const settings = await window.tr.settings.get()
  startShip(
    shipContextFor({
      projectRoot: project.rootPath,
      worktreePath: worktree.path,
      preflight,
      changes,
      pr: plan.pr,
      agentSession: agent?.id ?? null,
      openIn: session.id,
      checksLine: checks ? `这一轮的检查：${checksText(checks)}` : null,
      settings: { review: settings.review, pr: settings.pr }
    }),
    exit.kind === 'open-pr' ? 'push-pr' : exit.kind,
    exit.label
  )
  return { ok: true }
}

export async function remoteShipAction(sessionId: string, action: RemoteShipAction): Promise<RemoteResult> {
  const place = placeOf(sessionId)
  if (!place) return remoteFail('会话不存在')
  const path = place.worktree.path
  if (action.do === 'start') return start(place, action.exit)
  const state = useShips.getState().byWorktree[path]
  if (!state) return remoteFail('这个出口已经结束了')
  // The text can be changed while it is shown: at the last look, and after a failed run (Ship block `showFields`).
  const failedInRun = state.error !== null && state.failedIn === 'running'
  switch (action.do) {
    case 'edit':
      if (state.stage !== 'glance' && !failedInRun) return remoteFail('现在不能改')
      editShip(path, action.texts)
      return { ok: true }
    case 'submit': {
      if (state.stage !== 'glance' || state.error) return remoteFail('还没写好')
      const blocker = submitBlocker(state)
      if (blocker) return remoteFail(blocker)
      submitShip(path)
      return { ok: true }
    }
    case 'retry': {
      if (!state.error) return remoteFail('没有要重试的步骤')
      const blocker = failedInRun ? submitBlocker(state) : null
      if (blocker) return remoteFail(blocker)
      retryShip(path)
      return { ok: true }
    }
    case 'cancel':
      if (state.stage === 'running' && !state.error) return remoteFail('正在执行，不能取消')
      cancelShip(path)
      return { ok: true }
    case 'conflicts': {
      if (!state.error?.conflicts) return remoteFail('没有冲突要交给 agent')
      const ws = useWorkspace.getState()
      if (!commentTarget(place.worktree, ws.sessions, ws.worktrees, place.session.id)) return remoteFail('这个 worktree 没有 agent 会话')
      await handConflictsToAgent(path)
      return useShips.getState().byWorktree[path] ? fail(place, useShips.getState().byWorktree[path]!.error?.message ?? '没能交给 agent') : { ok: true }
    }
    case 'switch-pr':
      if (!state.error?.pushRefused) return remoteFail('推送没有被拒绝')
      switchToPr(path)
      return { ok: true }
  }
}

export async function remoteArchive(sessionId: string): Promise<RemoteResult> {
  const place = placeOf(sessionId)
  if (!place) return remoteFail('会话不存在')
  const blocker = await archiveBlocker(place)
  if (blocker) return remoteFail(blocker)
  const target = archiveTargetFor(place.worktree.id)!
  const outcome = await archiveWorktree(target, { unattended: true })
  if (outcome.ok) return { ok: true }
  return fail(place, outcome.stage === 'script' ? `${outcome.message}；可以在 Mac 上选择仍然归档` : outcome.message)
}
