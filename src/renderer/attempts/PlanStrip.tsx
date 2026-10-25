// Under the terminal while the session's agent waits for its plan to be approved (Figma 26C): 同任务多解… starts the
// dialog from the plan's text. Approving or rejecting stays in the agent's own TUI.
import { agentName } from '@shared/agents'
import { promptPreview } from '@shared/attempt-groups'
import { useActiveSession } from '../state/workspace'
import { PromptStrip } from './PromptStrip'
import { openSameTask } from './same-task-store'
import { useTaskSources } from './sources'

export function PlanStrip() {
  const active = useActiveSession()
  const session = active?.session
  const plan = useTaskSources((s) => (session ? s.plans[session.id] : undefined))
  if (!session || session.kind === 'shell' || !plan) return null
  return (
    <PromptStrip
      testId="plan-strip"
      question={`${agentName(session.kind)} 写好了计划`}
      detail={promptPreview(plan, 200)}
      actions={[{ label: '同任务多解…', keys: '⇧⌘N', onClick: () => openSameTask(session.id, '') }]}
    />
  )
}
