// Git · 变更's GitHub parts beyond the PR line (PRD F16 v1.63 / v1.78): the per-PR switches with what they are doing
// (Figma 29I) and, when 自动修复's brake stopped, the stopped row with its buttons (29G; shared with the base rows in
// BaseCiRow.tsx). Comment bodies are untrusted text: shown as plain text, quoted as data when sent.
import { TriangleAlert } from 'lucide-react'
import type { PrStatus } from '@shared/pull-requests'
import {
  agentIdle,
  agentName,
  declineFix,
  discardFix,
  prWantsFix,
  proceedAnyway,
  pushAnyway,
  retryFix,
  setAutoFix,
  setMergeWhenGreen,
  stopFix
} from '../../pull-requests/auto-fix'
import { brakeLabel } from '@shared/auto-fix-brakes'
import { automationText, mergeWhenGreenOn, stopActions, type FixRun, type FixScope } from '../../pull-requests/auto-fix-model'
import { usePullRequests } from '../../pull-requests/store'
import { useWorkspace } from '../../state/workspace'
import { Toggle } from '../../ui/Toggle'
import ci from './CiRows.module.css'

/** The worktree's agent session, for the rows' switches and words (the first Claude / Codex session of the worktree). */
export function useAgentOf(worktreePath: string) {
  return useWorkspace((s) => {
    const ids = new Set(s.worktrees.filter((w) => w.path === worktreePath).map((w) => w.id))
    return s.sessions.find((x) => ids.has(x.worktreeId) && (x.kind === 'claude' || x.kind === 'codex')) ?? null
  })
}

/** The brake stopped, or the base fails already (Figma 29G): an alert icon and the reason in primary text. */
export function FixStopLine({ run, note }: { run: Extract<FixRun, { kind: 'stopped' }>; note: string | null }) {
  const text = brakeLabel(run.decision)
  return (
    <p className={ci.stop} role="status" data-testid="fix-stop">
      <span className={ci.stopIcon}>
        <TriangleAlert size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <span className={ci.text} title={note ? `${text}\n${note}` : text}>
        {text}
      </span>
    </p>
  )
}

/** The stopped row's buttons: 仍然推送 · 丢弃 · 让 Claude 重修, or for the base failing already 在这里修 · 不修. */
export function FixStopActions({ scope, worktreePath, run, agent }: { scope: FixScope; worktreePath: string; run: Extract<FixRun, { kind: 'stopped' }>; agent: string }) {
  const actions = stopActions(run)
  if (actions.kind === 'ask') {
    return (
      <div className={ci.actions} data-testid="fix-stop-actions">
        <button type="button" className={ci.action} onClick={() => proceedAnyway(scope, worktreePath)}>
          在这里修
        </button>
        <button type="button" className={ci.action} onClick={() => declineFix(scope, worktreePath)}>
          不修
        </button>
      </div>
    )
  }
  return (
    <div className={ci.actions} data-testid="fix-stop-actions">
      {actions.push && (
        <button type="button" className={ci.action} title="不管刹车，把这次修复推上去（先确认）" onClick={() => void pushAnyway(scope, worktreePath)}>
          仍然推送
        </button>
      )}
      {actions.discard && (
        <button type="button" className={ci.action} title="把分支退回修复开始前的提交" onClick={() => void discardFix(scope, worktreePath)}>
          丢弃
        </button>
      )}
      <button type="button" className={ci.action} data-primary="" onClick={() => void retryFix(scope, worktreePath)}>
        {`让 ${agent} 重修`}
      </button>
    </div>
  )
}

/** 停下 while the agent works on a fix. */
export function FixStopButton({ scope, worktreePath, run }: { scope: FixScope; worktreePath: string; run: FixRun | null | undefined }) {
  if (run?.kind !== 'fixing') return null
  return (
    <button type="button" className={ci.action} onClick={() => stopFix(scope, worktreePath)}>
      停下
    </button>
  )
}

/** 自动修复 · 通过后合并 (PRD F16 · L3, Figma 29I) and what they are doing; the stopped row when a brake stopped. Open PRs only. */
export function PrAutomationRow({ worktreePath, status }: { worktreePath: string; status: PrStatus }) {
  const stored = usePullRequests((s) => s.automation[worktreePath])
  const session = useAgentOf(worktreePath)
  const pr = status.pr
  if (!pr || (pr.state !== 'open' && pr.state !== 'draft')) return null
  const state = stored?.number === pr.number ? stored : undefined
  const merging = mergeWhenGreenOn(status)
  const name = agentName(session)
  const words = automationText(state, status, { idle: agentIdle(session), wants: state?.autoFix === true && prWantsFix(worktreePath, status), name })
  const stopped = state?.run?.kind === 'stopped' ? state.run : null
  return (
    <>
      {stopped && <FixStopLine run={stopped} note={state?.note ?? null} />}
      <div className={ci.row} data-testid="pr-automation">
        <Toggle
          label="自动修复"
          checked={state?.autoFix === true}
          disabled={!session}
          title={session ? 'CI 失败或有新评论时，等 agent 空闲后让它修并提交，Wavi 检查后推送（用你的额度，每个 PR 有次数上限）' : '这个 worktree 没有 agent 会话'}
          onChange={(on) => setAutoFix(worktreePath, on)}
        />
        <span className={ci.label}>自动修复</span>
        <span className={ci.gap} />
        <Toggle
          label="通过后合并"
          checked={merging}
          disabled={!pr.details || pr.state === 'draft'}
          title={pr.state === 'draft' ? '草稿 PR 不能合并' : '检查通过后合并：仓库开了自动合并时由 GitHub 合并，否则 Wavi 开着时由 Wavi 合并'}
          onChange={(on) => void setMergeWhenGreen(worktreePath, on)}
        />
        <span className={ci.label}>通过后合并</span>
        <span className={ci.spacer} />
        {words.text && (
          <span className={ci.state} data-tone={words.tone} title={state?.note ? `${words.text}\n${state.note}` : words.text}>
            {words.text}
          </span>
        )}
        <FixStopButton scope="pr" worktreePath={worktreePath} run={state?.run} />
      </div>
      {stopped && <FixStopActions scope="pr" worktreePath={worktreePath} run={stopped} agent={name} />}
    </>
  )
}

