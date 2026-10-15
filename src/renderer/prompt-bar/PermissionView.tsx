import type { PendingPrompt, PermissionDecision } from '@shared/agent-events'
import type { AgentKind } from '@shared/types'
import { answerPermission } from './answer'
import { BarHead } from './BarHead'
import { OptionItem } from './OptionItem'
import { permissionDetail, permissionOptions, permissionTitle } from './present'
import { focusComposer, useDigitKeys } from './useDigitKeys'
import styles from './PromptBar.module.css'

export function PermissionView({
  prompt,
  agent,
  counter
}: {
  prompt: Extract<PendingPrompt, { kind: 'permission' }>
  agent: AgentKind
  counter: string | null
}) {
  const options = permissionOptions(prompt)
  // 拒绝并说明…: the agent goes on without the tool; the composer is where the user says what to do instead.
  const answer = (decision: PermissionDecision) => {
    answerPermission(prompt, decision)
    if (decision === 'deny') requestAnimationFrame(focusComposer)
  }

  useDigitKeys((n) => {
    const option = options.find((o) => o.key === n)
    if (!option) return false
    answer(option.decision)
    return true
  })

  return (
    <>
      <BarHead title={permissionTitle(prompt, agent)} detail={permissionDetail(prompt)} counter={counter} />
      <div className={styles.options}>
        {options.map((o) => (
          <OptionItem
            key={o.decision}
            number={o.key}
            label={o.label}
            focused={o.key === 1}
            onClick={() => answer(o.decision)}
          />
        ))}
      </div>
    </>
  )
}
