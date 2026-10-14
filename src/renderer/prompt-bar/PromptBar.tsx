// Permission request / AskUserQuestion bar above the composer — Figma `PromptBar` (11:173), screen 02.
// Shows the active session's oldest pending prompt; answering is a click, a digit key, or ⌥digit while the
// composer holds text. Esc never dismisses (the agent is still waiting): it only returns focus to the composer.
import { useEffect, type KeyboardEvent } from 'react'
import { useActiveSession, useWorkspace } from '../state/workspace'
import { PermissionView } from './PermissionView'
import { queueLabel } from './present'
import { QuestionView } from './QuestionView'
import { usePendingPrompts, usePromptStore } from './store'
import { focusComposer } from './useDigitKeys'
import styles from './PromptBar.module.css'

/** Feeds the store from window.tr.agent and forgets prompts of closed sessions. */
function usePromptSources(): void {
  useEffect(() => {
    const store = usePromptStore.getState()
    const agent = window.tr?.agent
    const offs = [
      agent?.onPrompt((prompt) => store.add(prompt)),
      agent?.onPromptResolved((resolution) => store.resolve(resolution.id)),
      useWorkspace.subscribe((state, prev) => {
        if (state.sessions !== prev.sessions) store.keepSessions(new Set(state.sessions.map((s) => s.id)))
      })
    ]
    return () => offs.forEach((off) => off?.())
  }, [])
}

export function PromptBar() {
  usePromptSources()
  const active = useActiveSession()
  const sessionId = active?.session.id ?? null
  const prompts = usePendingPrompts(sessionId)
  const progress = usePromptStore((s) => (prompts[0] ? (s.questionProgress[prompts[0].id] ?? 0) : 0))
  const error = usePromptStore((s) => s.error)

  const current = prompts[0]
  if (!active || !current) return null

  const counter = queueLabel(prompts.length)
  const visibleError = error?.promptId === current.id ? error.message : null

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.nativeEvent.isComposing) return
    e.preventDefault()
    e.stopPropagation()
    focusComposer()
  }

  return (
    <section
      className={styles.bar}
      data-region="prompt-bar"
      data-prompt-kind={current.kind}
      aria-label="待处理请求"
      aria-live="polite"
      onKeyDown={onKeyDown}
    >
      {current.kind === 'permission' ? (
        <PermissionView key={current.id} prompt={current} agent={active.session.kind} counter={counter} />
      ) : (
        <QuestionView
          key={`${current.id}:${Math.min(progress, current.questions.length - 1)}`}
          prompt={current}
          questionIndex={Math.min(progress, current.questions.length - 1)}
          counter={counter}
        />
      )}
      {visibleError && (
        <p className={styles.error} role="alert">
          没有送达终端：{visibleError}
        </p>
      )}
    </section>
  )
}
