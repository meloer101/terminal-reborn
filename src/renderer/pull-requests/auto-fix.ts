// 自动修复 and 通过后合并 per PR (PRD F16 v1.63 · L3), the bridge. Both are off until the user turns them on (per PR in
// Git · 变更, or for new PRs in 设置 · 自动化 · PR): they spend the user's quota and act on GitHub as the user.
// 自动修复 waits for the worktree's agent to be idle, then sends the failing checks' log and the allowed review threads
// and presses Enter; auto-fix-model.ts decides when, and when to stop. 通过后合并 is GitHub auto-merge (or Wavi's own
// wait); a new allowed thread or a P0 / P1 review turns it off again, since GitHub would merge past them.
import { ciFixPrompt, prThreadsPrompt, type PrStatus } from '@shared/pull-requests'
import { DEFAULT_SETTINGS, type PrSettings } from '@shared/settings'
import type { Session } from '@shared/types'
import { submitPrompt } from '../session-io'
import { useBackgroundReview } from '../review/background'
import { useWorkspace } from '../state/workspace'
import { afterSend, allowedThreads, autoFixDecision, freshAutomation, mergeWhenGreenOn, type PrAutomation } from './auto-fix-model'
import { setAutomation, setPrNotice, usePullRequests } from './store'

/** Every 自动修复 prompt starts with this, so its own UserPromptSubmit is not taken for the user taking over. */
export const AUTO_FIX_MARK = '（Wavi 自动修复'

let settings: PrSettings = DEFAULT_SETTINGS.pr
const sending = new Set<string>()
/** Worktree → the PR number whose new-PR defaults were applied (once per PR). */
const initialized = new Map<string, number>()

/** The worktree's agent session (the active one when it is there), or null. */
function agentFor(worktreePath: string): Session | null {
  const state = useWorkspace.getState()
  const ids = new Set(state.worktrees.filter((w) => w.path === worktreePath).map((w) => w.id))
  const sessions = state.sessions.filter((s) => ids.has(s.worktreeId) && (s.kind === 'claude' || s.kind === 'codex'))
  return sessions.find((s) => s.id === state.activeSessionId) ?? sessions[0] ?? null
}

export const agentIdle = (session: Session | null): boolean =>
  session !== null && session.phase !== 'exited' && session.phase !== 'not-started' && (session.status === 'idle' || session.status === 'done_unread')

function projectRootOf(worktreePath: string): string | null {
  const state = useWorkspace.getState()
  const worktree = state.worktrees.find((w) => w.path === worktreePath)
  return state.projects.find((p) => p.id === worktree?.projectId)?.rootPath ?? null
}

/** A system notification that opens the session when clicked (status/bridge.ts). */
function notify(session: Session, body: string): void {
  window.tr.ui.notify({ title: session.title, body, tag: session.id })
}

/** Turns 通过后合并 on (GitHub auto-merge, or Wavi waits) or off. Returns the line to show when it did not work. */
export async function setMergeWhenGreen(worktreePath: string, on: boolean): Promise<string | null> {
  const root = projectRootOf(worktreePath)
  const details = usePullRequests.getState().byWorktree[worktreePath]?.pr?.details
  if (!root || !details) return '没能读到 PR 的状态'
  const result = on
    ? await window.tr.pr.merge({ root, worktree: worktreePath, method: details.repo.defaultMethod, when: 'when-ready', deleteRemoteBranch: false })
    : await window.tr.pr.cancelMerge({ root, worktree: worktreePath })
  if (result.ok) {
    setPrNotice(worktreePath, null)
    return null
  }
  setPrNotice(worktreePath, { tone: result.reason === 'declined' ? 'muted' : 'error', text: result.message })
  return result.message
}

export function setAutoFix(worktreePath: string, on: boolean): void {
  const status = usePullRequests.getState().byWorktree[worktreePath]
  const number = status?.pr?.number
  if (!number) return
  const current = usePullRequests.getState().automation[worktreePath]
  // Turning it on again starts over: the user looked at why it stopped.
  setAutomation(worktreePath, current && current.number === number && !on ? { ...current, autoFix: false } : freshAutomation(number, on))
}

async function send(worktreePath: string, status: PrStatus, state: PrAutomation, session: Session): Promise<void> {
  const pr = status.pr!
  const decision = autoFixDecision(state, { pr, agentIdle: true, max: settings.maxAutoFixes, bots: settings.bots })
  if (decision.kind !== 'send') return
  sending.add(worktreePath)
  setAutomation(worktreePath, afterSend(state, decision))
  try {
    const parts = [`${AUTO_FIX_MARK} 第 ${state.attempts + 1} 次）`]
    if (decision.failing.length > 0) {
      const failure = await window.tr.pr.failure(worktreePath)
      if (failure) parts.push(ciFixPrompt(failure))
    }
    if (decision.threads.length > 0) parts.push(prThreadsPrompt(pr.number, decision.threads))
    parts.push('修好后提交并推送到这个分支。')
    await submitPrompt(session.id, parts.join('\n\n'))
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    setAutomation(worktreePath, { ...afterSend(state, decision), stopped: `自动修复已停：没能发送（${why}）` })
    notify(session, `PR #${pr.number} 的自动修复没能发送：${why}`)
  } finally {
    sending.delete(worktreePath)
  }
}

function step(): void {
  const { byWorktree, automation, gh } = usePullRequests.getState()
  if (gh !== 'ready') return
  for (const [worktreePath, status] of Object.entries(byWorktree)) {
    const pr = status.pr
    if (!pr || (pr.state !== 'open' && pr.state !== 'draft')) continue
    let state = automation[worktreePath]
    // Another PR on this branch starts from the defaults again.
    if (initialized.get(worktreePath) !== pr.number) {
      initialized.set(worktreePath, pr.number)
      if (!state || state.number !== pr.number) {
        state = freshAutomation(pr.number, settings.autoFix)
        setAutomation(worktreePath, state)
        if (settings.mergeWhenGreen && pr.details && !mergeWhenGreenOn(status)) void setMergeWhenGreen(worktreePath, true)
      }
    }
    const session = agentFor(worktreePath)
    // 通过后合并 does not merge past a thread 自动修复 would act on, or a P0 / P1 the review found.
    if (mergeWhenGreenOn(status) && !pr.details?.inMergeQueue) {
      const review = useBackgroundReview.getState().byRoot[worktreePath]
      const severe = review?.phase === 'done' ? (review.counts?.P0 ?? 0) + (review.counts?.P1 ?? 0) : 0
      if (allowedThreads(pr, settings.bots).length > 0 || severe > 0) {
        void setMergeWhenGreen(worktreePath, false).then((failure) => {
          if (!failure) setPrNotice(worktreePath, { tone: 'muted', text: severe > 0 ? '审阅有 P0 / P1，已取消检查通过后合并' : '有没解决的评论，已取消检查通过后合并' })
        })
      }
    }
    if (!state?.autoFix || sending.has(worktreePath) || !session) continue
    const decision = autoFixDecision(state, { pr, agentIdle: agentIdle(session), max: settings.maxAutoFixes, bots: settings.bots })
    if (decision.kind === 'stop') {
      setAutomation(worktreePath, { ...state, stopped: decision.reason })
      notify(session, `PR #${pr.number}：${decision.reason}`)
    } else if (decision.kind === 'send') void send(worktreePath, status, state, session)
  }
}

let started = false

/** Once per window. Returns a function that stops listening. */
export function startPrAutomation(): () => void {
  if (started) return () => {}
  started = true
  const offSettings = window.tr.settings.onChange((next) => {
    settings = next.pr
  })
  void window.tr.settings.get().then((initial) => {
    settings = initial.pr
    step()
  })
  const offPr = usePullRequests.subscribe((s, prev) => {
    if (s.byWorktree !== prev.byWorktree || s.automation !== prev.automation) step()
  })
  const offWorkspace = useWorkspace.subscribe((s, prev) => {
    if (s.sessions !== prev.sessions) step()
  })
  // The user's own message in the session: 自动修复 counts from zero again (it may also have been the fix).
  const offEvents = window.tr.agent.onEvent(({ sessionId, event }) => {
    if (event.type !== 'prompt-submit' || event.prompt.startsWith(AUTO_FIX_MARK)) return
    const state = useWorkspace.getState()
    const session = state.sessions.find((s) => s.id === sessionId)
    const path = state.worktrees.find((w) => w.id === session?.worktreeId)?.path
    const current = path ? usePullRequests.getState().automation[path] : undefined
    if (path && current && current.attempts > 0) setAutomation(path, { ...current, attempts: 0, lastHead: null, stopped: null })
  })
  return () => {
    started = false
    offSettings()
    offPr()
    offWorkspace()
    offEvents()
  }
}
