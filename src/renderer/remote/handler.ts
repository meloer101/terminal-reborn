// What the phone asks the window to do (PRD F22): type a prompt (photos first, as F19 does with dropped files), press
// Esc, or start a session. Everything goes through the same code as the desktop's own buttons: the send protocol
// (§6.9), the new-session sheet's plan (F4) and the first-message launch dispatch uses (F21).
import { generateBranchName } from '@shared/new-session'
import { remoteFail, type RemoteResult, type RemoteWindowCommand } from '@shared/remote'
import { setLaunch } from '../dispatch/store'
import { createWorktreeFor, holdForWorktree, startEagerly } from '../new-session/creation'
import { branchProblemText, planCreate } from '../new-session/model'
import { insertPaths, interruptAgent, submitInputLine, submitPrompt, whenAgentReady } from '../session-io'
import { useWorkspace } from '../state/workspace'
import { randomId } from '../state/workspace-model'

const failure = (error: unknown): RemoteResult => remoteFail(error instanceof Error ? error.message : String(error))

async function send(sessionId: string, text: string, paths: string[]): Promise<RemoteResult> {
  const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
  if (!session || session.kind === 'shell') return remoteFail('会话不存在')
  if (session.phase === 'exited') return remoteFail('agent 已经退出')
  // A session restored after a restart starts when first shown; the phone counts as showing it.
  if (session.phase === 'not-started' || session.phase === 'starting') {
    startEagerly(sessionId)
    await whenAgentReady(sessionId)
  }
  if (paths.length > 0) await insertPaths(sessionId, paths)
  if (text.trim()) await submitPrompt(sessionId, text)
  else await submitInputLine(sessionId, '[Image #')
  return { ok: true }
}

async function newSession(command: Extract<RemoteWindowCommand, { type: 'new-session' }>): Promise<RemoteResult> {
  const workspace = useWorkspace.getState()
  const project = workspace.projects.find((p) => p.id === command.project)
  if (!project) return remoteFail('项目不存在')
  const [installed, info] = await Promise.all([window.tr.app.detectAgents(), window.tr.gitWorktrees.newSessionInfo(project.rootPath)])
  if (!installed[command.agent]) return remoteFail('Mac 上没有安装这个智能体')
  let id: string | null
  if (command.workdir === 'current' || !info.repo) {
    id = workspace.addSession(project.id, command.agent)
  } else {
    const branch = command.branch ?? generateBranchName(info.prefix, new Set(info.branches.map((b) => b.name)))
    const planned = planCreate(project.rootPath, info, { workdir: 'worktree', base: command.base ?? info.defaultBranch, branch, prepare: info.includeCount > 0 || info.hasSetup })
    if (!planned.plan) {
      if (planned.problem === 'no-base') return remoteFail('找不到这个基线分支')
      if (planned.problem === 'loading') return remoteFail('项目还在加载')
      return remoteFail(branchProblemText(planned.problem, branch) ?? '分支名不能用')
    }
    const plan = planned.plan
    if (plan.type === 'current') {
      id = workspace.addSession(project.id, command.agent)
    } else if (plan.type === 'existing') {
      id = workspace.addBackgroundSession(project.id, { path: plan.path, branch: plan.branch }, command.agent)
    } else {
      id = workspace.addBackgroundSession(project.id, { path: plan.path, branch: plan.request.branch, baseBranch: plan.request.base }, command.agent, randomId('s'))
      if (id) {
        holdForWorktree(id)
        void createWorktreeFor(id, command.agent, plan.request)
      }
    }
  }
  if (!id) return remoteFail('没能新建会话')
  if (command.prompt) setLaunch(id, { initialPrompt: command.prompt })
  startEagerly(id)
  return { ok: true, data: { session: id } }
}

export async function handleRemoteCommand(command: RemoteWindowCommand): Promise<RemoteResult> {
  try {
    switch (command.type) {
      case 'send':
        return await send(command.session, command.text, command.paths)
      case 'interrupt':
        await interruptAgent(command.session)
        return { ok: true }
      case 'new-session':
        return await newSession(command)
    }
  } catch (error) {
    return failure(error)
  }
}
