// What a GUI session's agent waits on (PRD F23, Figma 49″D–F): a card above the composer, its own block (bg/section),
// magenta only on the status glyph. Permission: 拒绝 ⎋ · 总是允许 · 允许 ↵, a change to a file drawn between the title and
// the buttons (Figma 59I). Question: numbered options + 其他…,
// 跳过 ⎋ · 提交 ↵. Plan: 继续规划 · 批准，编辑时问我 · 批准并自动接受编辑 ↵. Each card answers keys through `bindKeys`
// (the chat routes them, see ChatPane).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GuiAnswer, GuiPrompt } from '@shared/gui-chat'
import type { SessionId } from '@shared/types'
import { StatusGlyph } from '../ui/StatusGlyph'
import { ChatMarkdown } from './ChatMarkdown'
import { DiffBlock } from './DiffBlock'
import { permissionButtons, permissionPrimary, permissionTitle, pickChoice, planParts, questionAnswers, stepIndex, type CardKey, type QuestionChoice } from './model'
import styles from './Chat.module.css'

/** A card's key handler; true when the key did something. */
export type CardKeys = (key: NonNullable<CardKey>) => boolean

interface CardProps<P> {
  sessionId: SessionId
  prompt: P
  agentLabel: string
  answer(answer: GuiAnswer): void
  /** An answer is on its way: the buttons wait. */
  pending: boolean
  bindKeys(keys: CardKeys | null): void
}

export function PromptCard(props: Omit<CardProps<GuiPrompt>, 'prompt'> & { prompt: GuiPrompt }) {
  const { prompt } = props
  switch (prompt.kind) {
    case 'permission':
      return <PermissionCard {...props} prompt={prompt} />
    case 'question':
      return <QuestionCard {...props} prompt={prompt} />
    case 'plan':
      return <PlanCard {...props} prompt={prompt} />
  }
}

function Card({ label, title, children, testId }: { label: string; title: ReactNode; children: ReactNode; testId: string }) {
  return (
    <section className={styles.card} aria-label={label} data-testid={testId}>
      <header className={styles.cardHeader}>
        <StatusGlyph status="needs_you" />
        <h3 className={styles.cardTitle}>{title}</h3>
      </header>
      {children}
    </section>
  )
}

function Button({ label, shortcut, primary = false, disabled, onClick, title }: { label: string; shortcut?: string; primary?: boolean; disabled?: boolean; onClick(): void; title?: string }) {
  return (
    <button type="button" className={styles.button} data-primary={primary} disabled={disabled} onClick={onClick} title={title}>
      <span>{label}</span>
      {shortcut && <span className={styles.buttonShortcut}>{shortcut}</span>}
    </button>
  )
}

function PermissionCard({ prompt, agentLabel, answer, pending, bindKeys }: CardProps<Extract<GuiPrompt, { kind: 'permission' }>>) {
  const buttons = permissionButtons(prompt.options)
  const primary = permissionPrimary(buttons)
  const choose = (optionId: string | undefined): boolean => {
    if (!optionId || pending) return false
    answer({ kind: 'permission', id: prompt.id, optionId })
    return true
  }
  // Rebound after every render, so the keys see this render's state.
  useEffect(() => {
    bindKeys((key) => (key.type === 'primary' ? choose(primary?.id) : key.type === 'dismiss' ? choose(buttons.reject?.id) : false))
    return () => bindKeys(null)
  })
  return (
    <Card label="等你确认" title={permissionTitle(agentLabel, prompt.tool)} testId="gui-permission">
      {/* Figma 59I: a change to a file shows it, its path on the block's header in place of the detail line. */}
      {prompt.diff ? <DiffBlock diff={prompt.diff} header className={styles.cardDiff} /> : prompt.detail && <pre className={styles.cardDetail}>{prompt.detail}</pre>}
      <div className={styles.cardActions}>
        {buttons.reject && <Button label="拒绝" shortcut="⎋" disabled={pending} onClick={() => choose(buttons.reject?.id)} />}
        {buttons.always && buttons.always !== primary && <Button label="总是允许" title={buttons.always.label} disabled={pending} onClick={() => choose(buttons.always?.id)} />}
        {primary && <Button label={primary === buttons.always ? '总是允许' : '允许'} shortcut="↵" primary disabled={pending} onClick={() => choose(primary.id)} />}
      </div>
    </Card>
  )
}

function QuestionCard({ prompt, answer, pending, bindKeys }: CardProps<Extract<GuiPrompt, { kind: 'question' }>>) {
  const [step, setStep] = useState(0)
  const [choices, setChoices] = useState<(QuestionChoice | undefined)[]>([])
  const [focused, setFocused] = useState(0)
  const otherRef = useRef<HTMLInputElement>(null)
  const question = prompt.questions[step]
  const choice = choices[step]
  const count = (question?.options.length ?? 0) + 1

  const choose = (index: number): void => {
    if (!question) return
    const next = pickChoice(question, choice, index)
    setChoices((all) => Object.assign([...all], { [step]: next }))
    setFocused(index)
    if (next.kind === 'other') requestAnimationFrame(() => otherRef.current?.focus())
  }
  const submit = (): boolean => {
    if (pending) return false
    if (step < prompt.questions.length - 1) {
      if (!question || !choice) return false
      setStep(step + 1)
      setFocused(0)
      return true
    }
    const answers = questionAnswers(prompt.questions, choices)
    if (!answers) return false
    answer({ kind: 'question', id: prompt.id, answers })
    return true
  }
  const skip = (): boolean => {
    if (pending) return false
    answer({ kind: 'question', id: prompt.id, answers: {} })
    return true
  }
  /** ↵ / 提交: with nothing picked yet, the highlighted option is the answer (Figma 49″F: option 1 highlighted). */
  const primary = (): boolean => {
    if (pending || !question) return false
    if (choice !== undefined || question.multiSelect || focused >= count) return submit()
    const next = pickChoice(question, undefined, focused)
    if (next.kind === 'other') {
      choose(focused)
      return true
    }
    const all = Object.assign([...choices], { [step]: next })
    setChoices(all)
    if (step < prompt.questions.length - 1) {
      setStep(step + 1)
      setFocused(0)
      return true
    }
    const answers = questionAnswers(prompt.questions, all)
    if (!answers) return false
    answer({ kind: 'question', id: prompt.id, answers })
    return true
  }
  const onKey: CardKeys = (key) => {
    switch (key.type) {
      case 'primary':
        return primary()
      case 'dismiss':
        return skip()
      case 'pick':
        if (key.index >= count) return false
        choose(key.index)
        return true
      case 'move':
        setFocused((at) => stepIndex(at, key.delta, count))
        return true
    }
  }
  useEffect(() => {
    bindKeys(onKey)
    return () => bindKeys(null)
  })
  if (!question) return null

  const picked = (index: number): boolean => (index === question.options.length ? choice?.kind === 'other' : choice?.kind === 'option' && choice.indexes.includes(index))
  return (
    <Card label="等你回答" title={question.question} testId="gui-question">
      <div className={styles.options} role={question.multiSelect ? 'group' : 'radiogroup'} aria-label={question.header ?? question.question}>
        {[...question.options.map((o) => o.label), '其他…'].map((label, index) => (
          <button
            key={index}
            type="button"
            role={question.multiSelect ? 'checkbox' : 'radio'}
            aria-checked={picked(index)}
            className={styles.option}
            data-focused={focused === index || picked(index)}
            title={question.options[index]?.description}
            onClick={() => choose(index)}
          >
            <span className={styles.optionKey}>{index + 1}</span>
            <span className={styles.optionLabel}>{label}</span>
          </button>
        ))}
        {choice?.kind === 'other' && (
          <input
            ref={otherRef}
            className={styles.otherInput}
            aria-label="其他"
            value={choice.text}
            onChange={(e) => {
              const text = e.currentTarget.value
              setChoices((all) => Object.assign([...all], { [step]: { kind: 'other', text } }))
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                submit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setChoices((all) => Object.assign([...all], { [step]: undefined }))
              }
            }}
          />
        )}
      </div>
      <div className={styles.cardActions}>
        <Button label="跳过" shortcut="⎋" disabled={pending} onClick={skip} />
        <Button label={step < prompt.questions.length - 1 ? '下一个' : '提交'} shortcut="↵" primary disabled={pending} onClick={primary} />
      </div>
    </Card>
  )
}

function PlanCard({ sessionId, prompt, answer, pending, bindKeys }: CardProps<Extract<GuiPrompt, { kind: 'plan' }>>) {
  const { title, body } = planParts(prompt.plan)
  const decide = (decision: 'keep-planning' | 'approve-ask' | 'approve-auto'): boolean => {
    if (pending) return false
    answer({ kind: 'plan', id: prompt.id, decision })
    return true
  }
  useEffect(() => {
    bindKeys((key) => (key.type === 'primary' ? decide('approve-auto') : false))
    return () => bindKeys(null)
  })
  return (
    <Card label="等你确认计划" title={title} testId="gui-plan">
      {body && <ChatMarkdown sessionId={sessionId} text={body} className={styles.planBody} />}
      <div className={`${styles.cardActions} ${styles.planActions}`}>
        <Button label="继续规划" disabled={pending} onClick={() => decide('keep-planning')} />
        <Button label="批准，编辑时问我" disabled={pending} onClick={() => decide('approve-ask')} />
        <Button label="批准并自动接受编辑" shortcut="↵" primary disabled={pending} onClick={() => decide('approve-auto')} />
      </div>
    </Card>
  )
}
