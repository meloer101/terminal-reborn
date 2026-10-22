// 设置 · 自动化 · 代码审阅 (PRD F13), PR (PRD F16 v1.63), 派活 (PRD F21) and 额度提醒 (PRD F11, Figma 18D). Every automatic review is off until the user turns it on: a review spends their
// own Claude / Codex quota. No Figma frame yet; it follows the Worktree pane (16A): sections of label · control rows.
import { useState } from 'react'
import { DEFAULT_REVIEW_RULES } from '@shared/background-review'
import type { AlertSettings, DispatchSettings, PrSettings, ReviewSettings } from '@shared/settings'
import { Segmented } from '../ui/Segmented'
import { Row, Section, Toggle } from './controls'
import styles from './AutomationPane.module.css'

const MODEL = /^[A-Za-z0-9._:@/-]{0,64}$/

export function AutomationPane({
  review,
  update,
  alerts,
  updateAlerts,
  pr,
  updatePr,
  dispatch,
  updateDispatch
}: {
  review: ReviewSettings
  update: (patch: Partial<ReviewSettings>) => void
  alerts: AlertSettings
  updateAlerts: (patch: Partial<AlertSettings>) => void
  pr: PrSettings
  updatePr: (patch: Partial<PrSettings>) => void
  dispatch: DispatchSettings
  updateDispatch: (patch: Partial<DispatchSettings>) => void
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
              <Row label="谁来审">
                <Segmented
                  label="谁来审"
                  value={review.reviewer}
                  options={[
                    { value: 'same', label: '和会话相同' },
                    { value: 'other', label: '另一家' }
                  ]}
                  onChange={(reviewer) => update({ reviewer })}
                />
              </Row>
              <p className={styles.hint}>
                {review.reviewer === 'other'
                  ? 'Claude 会话的改动由 Codex 审，Codex 会话的由 Claude 审；另一家没装时改用会话自己的。'
                  : '用会话自己的 Claude / Codex 审阅。'}
              </p>
              <Row label="Claude 审阅模型">
                <ModelField label="Claude 审阅模型" value={review.model} onCommit={(model) => update({ model })} />
              </Row>
              <Row label="Codex 审阅模型">
                <ModelField label="Codex 审阅模型" value={review.codexModel} onCommit={(codexModel) => update({ codexModel })} />
              </Row>
              <p className={styles.hint}>留空用 CLI 自己的默认模型。</p>
            </>
          )}
        </Section>
        <Section title="PR">
          <p className={styles.lead}>自动修复和通过后合并在变更视图里按 PR 打开，这里定新 PR 一开始是什么样。它们会用你的额度，并以你的 GitHub 账号操作，默认都不开。</p>
          <Row label="PR 正文附上检查和审阅结果">
            <Toggle label="PR 正文附上检查和审阅结果" checked={pr.evidence} onChange={(evidence) => updatePr({ evidence })} />
          </Row>
          <Row label="新 PR 打开自动修复">
            <Toggle label="新 PR 打开自动修复" checked={pr.autoFix} onChange={(autoFix) => updatePr({ autoFix })} />
          </Row>
          <Row label="新 PR 打开通过后合并">
            <Toggle label="新 PR 打开通过后合并" checked={pr.mergeWhenGreen} onChange={(mergeWhenGreen) => updatePr({ mergeWhenGreen })} />
          </Row>
          <Row label="自动修复最多">
            <Segmented
              label="自动修复最多"
              value={String(pr.maxAutoFixes)}
              options={['1', '2', '3', '4', '5'].map((n) => ({ value: n, label: `${n} 次` }))}
              onChange={(n) => updatePr({ maxAutoFixes: Number(n) })}
            />
          </Row>
          <Row label="也认这些机器人">
            <BotsField value={pr.bots} onCommit={(bots) => updatePr({ bots })} />
          </Row>
          <p className={styles.hint}>自动修复只把你自己和这里列出的机器人（如 coderabbitai[bot]）的评论发给 agent；其他人的评论只显示。有没解决的评论（来自上面这些人）或审阅里有 P0 / P1 时，通过后合并会自己关掉。</p>
        </Section>
        <Section title="派活">
          <p className={styles.lead}>会话里的 agent 可以用 Wavi 的工具开新的 Claude Code / Codex 会话、把任务分出去；它们各在新的 worktree 里干活，做完把结果报告给派活的会话。合并、推送和归档仍由你来做。</p>
          <Row label="让 agent 能开会话">
            <Toggle label="让 agent 能开会话" checked={dispatch.tools} onChange={(tools) => updateDispatch({ tools })} />
          </Row>
          <Row label="agent 开会话不再确认">
            <Toggle
              label="agent 开会话不再确认"
              checked={dispatch.autoApprove}
              disabled={!dispatch.tools}
              onChange={(autoApprove) => updateDispatch({ autoApprove })}
            />
          </Row>
          <p className={styles.hint}>
            关掉第一项后，之后启动的 agent 不再有这些工具。默认每次开会话都先弹出确认，写明开几个、什么 agent、发什么任务；打开第二项后直接开始，仍然最多同时 4 个，被派出的会话不能再往下派。每个会话都用你自己的额度。
          </p>
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

function ModelField({ label, value, onCommit }: { label: string; value: string; onCommit: (model: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? value
  const valid = MODEL.test(shown.trim())
  return (
    <input
      className={styles.model}
      aria-label={label}
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
        // Enter / Esc while an input method composes confirm / cancel the composition.
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') {
          setDraft(null)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

/** Bot logins, separated by commas or spaces; committed on blur or Enter. */
function BotsField({ value, onCommit }: { value: string[]; onCommit: (bots: string[]) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? value.join(', ')
  return (
    <input
      className={styles.model}
      aria-label="也认这些机器人"
      autoComplete="off"
      spellCheck={false}
      placeholder="没有"
      value={shown}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        onCommit(shown.split(/[\s,，]+/).filter(Boolean))
        setDraft(null)
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') {
          setDraft(null)
          event.currentTarget.blur()
        }
      }}
    />
  )
}
