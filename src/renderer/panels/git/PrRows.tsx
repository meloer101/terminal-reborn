// Git · 变更's GitHub parts beyond the PR headline (PRD F16 v1.63 / v1.78, Figma 29R): the per-PR switches — label
// first, then the switch — and what they are doing (said in the zone's facts line), and, when 自动修复 stopped — a
// brake, or the base failing already — the decision surface: the question or the brake's reason with its answers in
// place of the exits (29G / 29J; shared with the base rows in BaseCiRow.tsx).
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
import { automationText, mergeWhenGreenOn, stopActions, stopParts, type FixRun, type FixScope } from '../../pull-requests/auto-fix-model'
import { useBaseCi } from '../../pull-requests/base-ci'
import { usePullRequests } from '../../pull-requests/store'
import { useWorkspace } from '../../state/workspace'
import { Toggle } from '../../ui/Toggle'
import ci from './CiRows.module.css'

type StoppedRun = Extract<FixRun, { kind: 'stopped' }>

/** The worktree's agent session, for the rows' switches and words (the first Claude / Codex session of the worktree). */
export function useAgentOf(worktreePath: string) {
  return useWorkspace((s) => {
    const ids = new Set(s.worktrees.filter((w) => w.path === worktreePath).map((w) => w.id))
    return s.sessions.find((x) => ids.has(x.worktreeId) && (x.kind === 'claude' || x.kind === 'codex')) ?? null
  })
}

/** The stopped fix waiting for the user on this worktree, the PR's first, then the base push's; null when none. */
export function useStoppedFix(
  worktreePath: string,
  prNumber: number | null
): { scope: FixScope; run: StoppedRun; note: string | null; attempts: number } | null {
  const pr = usePullRequests((s) => s.automation[worktreePath])
  const base = useBaseCi((s) => s.automation[worktreePath])
  if (pr && prNumber !== null && pr.number === prNumber && pr.run?.kind === 'stopped') return { scope: 'pr', run: pr.run, note: pr.note ?? null, attempts: pr.attempts }
  if (base?.run?.kind === 'stopped') return { scope: 'base', run: base.run, note: base.note ?? null, attempts: base.attempts }
  return null
}

/**
 * The decision surface while a fix is stopped (Figma 29R; 29G / 29J), in place of the exits: the question (or the
 * brake's reason) with 不修 · 在这里修, or 仍然推送 · 丢弃 · 让 Claude 重修. A surface of its own, hung out by its padding
 * so its words stay on the text column.
 */
export function FixStopFooter({ scope, worktreePath, run, agent, note, attempts }: { scope: FixScope; worktreePath: string; run: StoppedRun; agent: string; note: string | null; attempts?: number }) {
  const actions = stopActions(run)
  const { question } = stopParts(run.decision, attempts)
  return (
    <div className={ci.decision} data-decision data-testid="fix-stop-actions">
      <span className={ci.question} role="status" data-testid="fix-stop" title={note ? `${question}\n${note}` : question}>
        {question}
      </span>
      <span className={ci.spacer} />
      {actions.kind === 'ask' ? (
        <>
          <button type="button" className={ci.action} onClick={() => declineFix(scope, worktreePath)}>
            不修
          </button>
          <button type="button" className={ci.action} data-primary onClick={() => proceedAnyway(scope, worktreePath)}>
            在这里修
          </button>
        </>
      ) : (
        <>
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
          <button type="button" className={ci.action} data-primary onClick={() => void retryFix(scope, worktreePath)}>
            {`让 ${agent} 重修`}
          </button>
        </>
      )}
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

/** What the PR's switches are doing (Figma 29I), for the zone's facts line — 自动修复先停, 第 2 次 · Claude 在修, … — and the fix note. */
export function usePrAutomationWords(worktreePath: string, status: PrStatus | null | undefined): { text: string | null; note: string | null } | null {
  const stored = usePullRequests((s) => s.automation[worktreePath])
  const session = useAgentOf(worktreePath)
  const pr = status?.pr
  if (!status || !pr || (pr.state !== 'open' && pr.state !== 'draft')) return null
  const state = stored?.number === pr.number ? stored : undefined
  const note = state?.note ?? null
  if (state?.run?.kind === 'stopped') return { text: stopParts(state.run.decision, state.attempts).fact, note }
  const words = automationText(state, status, { idle: agentIdle(session), wants: state?.autoFix === true && prWantsFix(worktreePath, status), name: agentName(session) })
  return { text: words.text || null, note }
}

/** 自动修复 · 通过后合并 (PRD F16 · L3, Figma 29R): the label, then its switch; 停下 at the end while a fix runs. Open PRs only. */
export function PrAutomationRow({ worktreePath, status }: { worktreePath: string; status: PrStatus }) {
  const stored = usePullRequests((s) => s.automation[worktreePath])
  const session = useAgentOf(worktreePath)
  const pr = status.pr
  if (!pr || (pr.state !== 'open' && pr.state !== 'draft')) return null
  const state = stored?.number === pr.number ? stored : undefined
  return (
    <div className={ci.switches} data-testid="pr-automation">
      <span className={ci.label}>自动修复</span>
      <Toggle
        label="自动修复"
        checked={state?.autoFix === true}
        disabled={!session}
        title={session ? 'CI 失败或有新评论时，等 agent 空闲后让它修并提交，Wavi 检查后推送（用你的额度，每个 PR 有次数上限）' : '这个 worktree 没有 agent 会话'}
        onChange={(on) => setAutoFix(worktreePath, on)}
      />
      <span className={ci.gap} />
      <span className={ci.label}>通过后合并</span>
      <Toggle
        label="通过后合并"
        checked={mergeWhenGreenOn(status)}
        disabled={!pr.details || pr.state === 'draft'}
        title={pr.state === 'draft' ? '草稿 PR 不能合并' : '检查通过后由 GitHub 合并（仓库要开着 auto-merge）'}
        onChange={(on) => void setMergeWhenGreen(worktreePath, on)}
      />
      <span className={ci.spacer} />
      <FixStopButton scope="pr" worktreePath={worktreePath} run={state?.run} />
    </div>
  )
}
