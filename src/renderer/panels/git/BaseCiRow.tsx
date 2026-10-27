// CI on the base after 合并到 main 并推送 pushed it (PRD F16 v1.78, Figma 29E / 29F / 29G), above the PR line in Git · 变更:
// the CI row with 打开 CI, the stopped row when 自动修复's brake stopped (or the base was failing already; its answers are
// the footer's, FixStopFooter), and the automation row with the switch and what it is doing. Only for a worktree that
// pushed a base commit.
import type { Worktree } from '@shared/types'
import { openPullRequest } from '../../pull-requests/actions'
import { agentIdle, agentName, baseWantsFix, setBaseAutoFix } from '../../pull-requests/auto-fix'
import { baseAutomationText } from '../../pull-requests/auto-fix-model'
import { baseCiText, useBaseCi, useBaseCiOf } from '../../pull-requests/base-ci'
import { ChecksMark } from '../../pull-requests/PrTag'
import { Toggle } from '../../ui/Toggle'
import ci from './CiRows.module.css'
import { FixStopButton, FixStopLine, useAgentOf } from './PrRows'

export function BaseCiRows({ worktree }: { worktree: Worktree }) {
  const base = useBaseCiOf(worktree.path)
  const state = useBaseCi((s) => s.automation[worktree.path])
  const session = useAgentOf(worktree.path)
  if (!base) return null
  const { mark, text } = baseCiText(base)
  const name = agentName(session)
  const words = baseAutomationText(state, { idle: agentIdle(session), wants: state?.autoFix === true && baseWantsFix(worktree.path), name })
  const stopped = state?.run?.kind === 'stopped' ? state.run : null
  return (
    <>
      {stopped && <FixStopLine run={stopped} note={state?.note ?? null} attempts={state?.attempts} />}
      <p className={ci.row} role="status" data-testid="base-ci">
        <ChecksMark state={mark} />
        <span className={ci.text} title={text}>
          {text}
        </span>
        <span className={ci.spacer} />
        {base.url && (
          <button
            type="button"
            className={ci.action}
            title={`在内置浏览器打开 ${base.url}`}
            onClick={() => base.url && openPullRequest(session?.id ?? null, base.url)}
          >
            打开 CI
          </button>
        )}
      </p>
      <div className={ci.row} data-testid="base-ci-automation">
        <Toggle
          label="自动修复"
          checked={state?.autoFix === true}
          disabled={!session}
          title={session ? `${base.base} 上的 CI 失败时，等 agent 空闲后让它修并提交，Wavi 检查后推送（用你的额度，有次数上限）` : '这个 worktree 没有 agent 会话'}
          onChange={(on) => setBaseAutoFix(worktree.path, on)}
        />
        <span className={ci.label}>自动修复</span>
        <span className={ci.spacer} />
        {words.text && (
          <span className={ci.state} data-tone={words.tone} title={state?.note ? `${words.text}\n${state.note}` : words.text}>
            {words.text}
          </span>
        )}
        <FixStopButton scope="base" worktreePath={worktree.path} run={state?.run} />
      </div>
    </>
  )
}
