// Git · 变更's GitHub parts beyond the PR line (PRD F16 v1.63 / v1.78): the per-PR switches with what they are doing
// (Figma 29I) and, when 自动修复 stopped — a brake, or the base failing already — the stopped row (29G / 29J; shared
// with the base rows in BaseCiRow.tsx). The stopped row's answers are the footer's buttons while it shows
// (FixStopFooter). Comment bodies are untrusted text: shown as plain text, quoted as data when sent.
import { CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
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
import { automationText, mergeWhenGreenOn, stopActions, stopLineText, type FixRun, type FixScope } from '../../pull-requests/auto-fix-model'
import { useBaseCi } from '../../pull-requests/base-ci'
import { usePullRequests } from '../../pull-requests/store'
import { useWorkspace } from '../../state/workspace'
import { Toggle } from '../../ui/Toggle'
import ci from './CiRows.module.css'
import styles from './GitView.module.css'

type StoppedRun = Extract<FixRun, { kind: 'stopped' }>

/** The worktree's agent session, for the rows' switches and words (the first Claude / Codex session of the worktree). */
export function useAgentOf(worktreePath: string) {
  return useWorkspace((s) => {
    const ids = new Set(s.worktrees.filter((w) => w.path === worktreePath).map((w) => w.id))
    return s.sessions.find((x) => ids.has(x.worktreeId) && (x.kind === 'claude' || x.kind === 'codex')) ?? null
  })
}

/** The stopped fix waiting for the user on this worktree, the PR's first, then the base push's; null when none. */
export function useStoppedFix(worktreePath: string, prNumber: number | null): { scope: FixScope; run: StoppedRun } | null {
  const pr = usePullRequests((s) => s.automation[worktreePath])
  const base = useBaseCi((s) => s.automation[worktreePath])
  if (pr && prNumber !== null && pr.number === prNumber && pr.run?.kind === 'stopped') return { scope: 'pr', run: pr.run }
  if (base?.run?.kind === 'stopped') return { scope: 'base', run: base.run }
  return null
}

/** The brake stopped (Figma 29G) or the base fails already (29J): an alert circle and the reason or question in primary text. */
export function FixStopLine({ run, note, attempts }: { run: StoppedRun; note: string | null; attempts?: number }) {
  const text = stopLineText(run.decision, attempts)
  return (
    <p className={ci.stop} role="status" data-testid="fix-stop">
      <span className={ci.stopIcon}>
        <CircleAlert size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <span className={ci.text} title={note ? `${text}\n${note}` : text}>
        {text}
      </span>
    </p>
  )
}

/**
 * The footer while a fix is stopped (Figma 29G / 29J), in place of the exits: 仍然推送 · 丢弃 · 让 Claude 重修, or for the
 * base failing already 不修 · 在这里修 (the PR stays one click away on the left).
 */
export function FixStopFooter({
  scope,
  worktreePath,
  run,
  agent,
  leading
}: {
  scope: FixScope
  worktreePath: string
  run: StoppedRun
  agent: string
  leading?: ReactNode
}) {
  const actions = stopActions(run)
  if (actions.kind === 'ask') {
    return (
      <div className={styles.footer} data-testid="fix-stop-actions">
        {leading}
        <span className={styles.spacer} />
        <button type="button" className={styles.ghostButton} onClick={() => declineFix(scope, worktreePath)}>
          不修
        </button>
        <button type="button" className={styles.primaryButton} onClick={() => proceedAnyway(scope, worktreePath)}>
          在这里修
        </button>
      </div>
    )
  }
  return (
    <div className={styles.footer} data-testid="fix-stop-actions">
      {actions.push && (
        <button type="button" className={styles.ghostButton} title="不管刹车，把这次修复推上去（先确认）" onClick={() => void pushAnyway(scope, worktreePath)}>
          仍然推送
        </button>
      )}
      <span className={styles.spacer} />
      {actions.discard && (
        <button type="button" className={styles.ghostButton} title="把分支退回修复开始前的提交" onClick={() => void discardFix(scope, worktreePath)}>
          丢弃
        </button>
      )}
      <button type="button" className={styles.primaryButton} onClick={() => void retryFix(scope, worktreePath)}>
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
      {stopped && <FixStopLine run={stopped} note={state?.note ?? null} attempts={state?.attempts} />}
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
          title={pr.state === 'draft' ? '草稿 PR 不能合并' : '检查通过后由 GitHub 合并（仓库要开着 auto-merge）'}
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
    </>
  )
}

