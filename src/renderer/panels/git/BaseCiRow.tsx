// CI on the base after 合并到 main 并推送 pushed it (PRD F16 v1.78, Figma 29E / 29F / 29G in the 29R grammar), at the top
// of Git · 变更's ship zone: the headline with the checks mark, 打开 CI at its end, what 自动修复 is doing as a facts
// line, and the switch (label first). A stopped fix asks on the decision surface (FixStopFooter). Only for a worktree
// that pushed a base commit.
import { Check, CircleDashed, X } from 'lucide-react'
import type { SessionId, Worktree } from '@shared/types'
import { openPullRequest } from '../../pull-requests/actions'
import { agentIdle, agentName, baseWantsFix, setBaseAutoFix } from '../../pull-requests/auto-fix'
import { baseAutomationText, stopParts } from '../../pull-requests/auto-fix-model'
import { baseCiText, useBaseCi, useBaseCiOf } from '../../pull-requests/base-ci'
import { Toggle } from '../../ui/Toggle'
import ci from './CiRows.module.css'
import { FixStopButton, useAgentOf } from './PrRows'

const MARK = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

export function BaseCiRows({ worktree, openIn }: { worktree: Worktree; openIn: SessionId | null }) {
  const base = useBaseCiOf(worktree.path)
  const state = useBaseCi((s) => s.automation[worktree.path])
  const session = useAgentOf(worktree.path)
  if (!base) return null
  const { mark, text } = baseCiText(base)
  const name = agentName(session)
  const words =
    state?.run?.kind === 'stopped'
      ? stopParts(state.run.decision, state.attempts).fact
      : baseAutomationText(state, { idle: agentIdle(session), wants: state?.autoFix === true && baseWantsFix(worktree.path), name }).text || null
  const Mark = mark === 'failing' ? X : mark === 'passing' ? Check : CircleDashed
  return (
    <>
      <p className={ci.headline} role="status" data-testid="base-ci">
        {mark !== 'none' && (
          <span className={ci.mark} data-checks={mark}>
            <Mark {...MARK} />
          </span>
        )}
        <span className={ci.headlineText} title={text}>
          {text}
        </span>
        <span className={ci.spacer} />
        {base.url && (
          <button type="button" className={ci.link} title={`在内置浏览器打开 ${base.url}`} onClick={() => base.url && openPullRequest(openIn ?? session?.id ?? null, base.url)}>
            打开 CI
          </button>
        )}
      </p>
      {words && (
        <p className={ci.facts} title={words}>
          {words}
        </p>
      )}
      <div className={ci.switches} data-testid="base-ci-automation">
        <span className={ci.label}>自动修复</span>
        <Toggle
          label="自动修复"
          checked={state?.autoFix === true}
          disabled={!session}
          title={session ? `${base.base} 上的 CI 失败时，等 agent 空闲后让它修并提交，Wavi 检查后推送（用你的额度，有次数上限）` : '这个 worktree 没有 agent 会话'}
          onChange={(on) => setBaseAutoFix(worktree.path, on)}
        />
        <span className={ci.spacer} />
        <FixStopButton scope="base" worktreePath={worktree.path} run={state?.run} />
      </div>
    </>
  )
}
