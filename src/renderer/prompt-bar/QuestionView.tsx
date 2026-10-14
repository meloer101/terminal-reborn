import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentQuestion, PendingPrompt } from '@shared/agent-events'
import { answerQuestion } from './answer'
import { BarHead } from './BarHead'
import { keepFocus, OptionItem } from './OptionItem'
import { useDigitKeys } from './useDigitKeys'
import styles from './PromptBar.module.css'

type Question = Extract<PendingPrompt, { kind: 'question' }>

/**
 * One question of an AskUserQuestion prompt. Mounted with a key per question, so picks and typed text reset
 * when the next question appears.
 */
export function QuestionView({
  prompt,
  questionIndex,
  counter
}: {
  prompt: Question
  questionIndex: number
  counter: string | null
}) {
  const question = prompt.questions[questionIndex]
  return question ? <QuestionBody prompt={prompt} question={question} questionIndex={questionIndex} counter={counter} /> : null
}

function QuestionBody({
  prompt,
  question,
  questionIndex,
  counter
}: {
  prompt: Question
  question: AgentQuestion
  questionIndex: number
  counter: string | null
}) {
  const total = prompt.questions.length
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set())
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherText, setOtherText] = useState('')
  const fieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (otherOpen) fieldRef.current?.focus()
  }, [otherOpen])

  const multi = question.multiSelect
  const optionCount = question.options.length
  const text = otherText.trim()
  const canSubmit = multi ? picked.size > 0 || (otherOpen && text !== '') : otherOpen && text !== ''

  const choose = (index: number) => {
    if (!multi) {
      void answerQuestion(prompt, questionIndex, { kind: 'single', index })
      return
    }
    setPicked((prev) => {
      const next = new Set(prev)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  const submit = () => {
    if (!canSubmit) return
    if (multi) {
      const other = otherOpen && text !== '' ? text : undefined
      void answerQuestion(prompt, questionIndex, { kind: 'multi', indices: [...picked], ...(other ? { other } : {}) })
    } else {
      void answerQuestion(prompt, questionIndex, { kind: 'other', text })
    }
  }

  useDigitKeys((n) => {
    if (n <= optionCount) choose(n - 1)
    else if (n === optionCount + 1) setOtherOpen((open) => !open)
    else return false
    return true
  })

  const onFieldKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
    e.preventDefault()
    submit()
  }

  const progress = total > 1 ? `问题 ${questionIndex + 1} / ${total}` : null
  const head = [progress, counter].filter(Boolean).join(' · ')

  return (
    <>
      <BarHead title={question.question} detail={question.header} counter={head || null} />
      <div className={styles.options}>
        {question.options.map((option, i) => (
          <OptionItem
            key={`${i}:${option.label}`}
            number={i + 1}
            label={option.label}
            description={option.description}
            focused={i === 0}
            selected={multi ? picked.has(i) : undefined}
            onClick={() => choose(i)}
          />
        ))}
        <OptionItem
          number={optionCount + 1}
          label="其他…"
          selected={multi ? otherOpen : undefined}
          onClick={() => setOtherOpen((open) => !open)}
        />
        {multi && (
          <button type="button" className={styles.submit} disabled={!canSubmit} onMouseDown={keepFocus} onClick={submit}>
            提交
          </button>
        )}
      </div>
      {otherOpen && (
        <div className={styles.freeText}>
          <input
            ref={fieldRef}
            className={styles.field}
            data-prompt-input
            aria-label="其他回答"
            placeholder="输入你的回答，↵ 提交"
            value={otherText}
            spellCheck={false}
            onChange={(e) => setOtherText(e.target.value)}
            onKeyDown={onFieldKeyDown}
          />
          {!multi && (
            <button type="button" className={styles.submit} disabled={!canSubmit} onMouseDown={keepFocus} onClick={submit}>
              提交
            </button>
          )}
        </div>
      )}
    </>
  )
}
