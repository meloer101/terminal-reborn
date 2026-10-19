// 设置 · 自动化 · 代码审阅 (PRD F13) and 额度提醒 (PRD F11, Figma 18D). Every automatic review is off until the user turns it on: a review spends their
// own Claude / Codex quota. No Figma frame yet; it follows the Worktree pane (16A): sections of label · control rows.
import { useState } from 'react'
import { DEFAULT_REVIEW_RULES } from '@shared/background-review'
import type { AlertSettings, ReviewSettings } from '@shared/settings'
import { Segmented } from '../ui/Segmented'
import { Row, Section, Toggle } from './controls'
import styles from './AutomationPane.module.css'

const MODEL = /^[A-Za-z0-9._:@/-]{0,64}$/

export function AutomationPane({
  review,
  update,
  alerts,
  updateAlerts
}: {
  review: ReviewSettings
  update: (patch: Partial<ReviewSettings>) => void
  alerts: AlertSettings
  updateAlerts: (patch: Partial<AlertSettings>) => void
}) {
  const builtin = review.mode === 'builtin'
  return (
    <div className={styles.page}>
      <div className={styles.form}>
        <h1 className={styles.title}>自动化</h1>
        <Section title="代码审阅">
          <p className={styles.lead}>Wavi 在后台另起一个只读的 Claude / Codex 审阅改动，结果变成变更里的评论，你勾选后再发给 agent。自动审阅会用你自己的登录和额度，默认都不开。</p>
          <Row label="合并前">
            <Toggle label="合并前自动审阅" checked={review.beforeMerge} onChange={(beforeMerge) => update({ beforeMerge })} />
          </Row>
          <Row label="Wavi 推送前">
            <Toggle label="Wavi 推送前自动审阅" checked={review.beforePush} onChange={(beforePush) => update({ beforePush })} />
          </Row>
          <Row label="一轮结束且有新提交时">
            <Toggle label="一轮结束且有新提交时自动审阅" checked={review.afterTurnWithCommits} onChange={(afterTurnWithCommits) => update({ afterTurnWithCommits })} />
          </Row>
          <p className={styles.hint}>自动审阅只提示，不会拦住合并、推送或 agent。打开合并面板时开始审阅；勾了「合并后推送到 origin」时也会审阅。</p>
          <Row label="审阅方式">
            <Segmented
              label="审阅方式"
              value={review.mode}
              options={[
                { value: 'builtin', label: 'Wavi 内置审阅' },
                { value: 'agent-command', label: 'agent 自带命令' }
              ]}
              onChange={(mode) => update({ mode })}
            />
          </Row>
          <p className={styles.hint}>
            {builtin ? '结果按 P0–P3 落成评论。' : '「让 agent 审阅」在会话里发送 /code-review 或 /review，结果留在终端，不解析成评论；自动审阅不会运行。'}
          </p>
          {builtin && (
            <>
              <Row label="审阅规则">
                <Segmented
                  label="审阅规则"
                  value={review.rules}
                  options={[
                    { value: 'default', label: '默认' },
                    { value: 'custom', label: '自定义' }
                  ]}
                  onChange={(rules) => update({ rules })}
                />
              </Row>
              {review.rules === 'custom' && <RulesField value={review.customRules} onCommit={(customRules) => update({ customRules })} />}
              <Row label="审阅模型">
                <ModelField value={review.model} onCommit={(model) => update({ model })} />
              </Row>
              <p className={styles.hint}>留空用 CLI 自己的默认模型。</p>
            </>
          )}
        </Section>
        <Section title="额度提醒">
          <Row label="额度提醒">
            <Toggle label="额度提醒" checked={alerts.usage} onChange={(usage) => updateAlerts({ usage })} />
          </Row>
          <p className={styles.hint}>每个厂商的每个额度窗口，用到 75%、90% 和用完时各发一次系统通知；额度是账号共用的，不按会话重复提醒。</p>
        </Section>
      </div>
    </div>
  )
}

function RulesField({ value, onCommit }: { value: string; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <textarea
      className={styles.rules}
      aria-label="自定义审阅规则"
      spellCheck={false}
      placeholder={DEFAULT_REVIEW_RULES}
      value={draft ?? value}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onCommit(draft)
        setDraft(null)
      }}
    />
  )
}

function ModelField({ value, onCommit }: { value: string; onCommit: (model: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? value
  const valid = MODEL.test(shown.trim())
  return (
    <input
      className={styles.model}
      aria-label="审阅模型"
      aria-invalid={!valid || undefined}
      autoComplete="off"
      spellCheck={false}
      placeholder="跟随 CLI"
      value={shown}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        const next = shown.trim()
        if (valid && next !== value) onCommit(next)
        setDraft(null)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') {
          setDraft(null)
          event.currentTarget.blur()
        }
      }}
    />
  )
}
