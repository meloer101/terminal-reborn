// 设置 · 自动化 · 代码审阅 (PRD F13), PR (PRD F16 v1.63; AI 写 v1.68) and 派活 (PRD F21); 额度提醒 moved to 设置 · 额度. Every automatic review is off until the user turns it on: a review spends their
// own Claude / Codex quota. Copy and layout follow Figma 16C (457:21367): section titles, then label · control rows, no explanatory lines.
import { useState } from 'react'
import { DEFAULT_REVIEW_RULES } from '@shared/background-review'
import type { DispatchSettings, PrSettings, ReviewSettings } from '@shared/settings'
import { Segmented } from '../ui/Segmented'
import { Row, Section, Toggle } from './controls'
import styles from './AutomationPane.module.css'

const MODEL = /^[A-Za-z0-9._:@/-]{0,64}$/

export function AutomationPane({
  review,
  update,
  pr,
  updatePr,
  dispatch,
  updateDispatch
}: {
  review: ReviewSettings
  update: (patch: Partial<ReviewSettings>) => void
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
          <Row label="合并前审阅">
            <Toggle label="合并前审阅" checked={review.beforeMerge} onChange={(beforeMerge) => update({ beforeMerge })} />
          </Row>
          <Row label="推送前审阅">
            <Toggle label="推送前审阅" checked={review.beforePush} onChange={(beforePush) => update({ beforePush })} />
          </Row>
          <Row label="每轮结束且有新提交时审阅">
            <Toggle label="每轮结束且有新提交时审阅" checked={review.afterTurnWithCommits} onChange={(afterTurnWithCommits) => update({ afterTurnWithCommits })} />
          </Row>
          <Row label="审阅方式">
            <Segmented
              label="审阅方式"
              value={review.mode}
              options={[
                { value: 'builtin', label: 'Wavi 内置' },
                { value: 'agent-command', label: '终端命令' }
              ]}
              onChange={(mode) => update({ mode })}
            />
          </Row>
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
              <Row label="由谁审">
                <Segmented
                  label="由谁审"
                  value={review.reviewer}
                  options={[
                    { value: 'same', label: '同一家' },
                    { value: 'other', label: '另一家' }
                  ]}
                  onChange={(reviewer) => update({ reviewer })}
                />
              </Row>
              <Row label="Claude 审阅模型">
                <ModelField label="Claude 审阅模型" value={review.model} onCommit={(model) => update({ model })} />
              </Row>
              <Row label="Codex 审阅模型">
                <ModelField label="Codex 审阅模型" value={review.codexModel} onCommit={(codexModel) => update({ codexModel })} />
              </Row>
            </>
          )}
        </Section>
        <Section title="PR">
          <Row label="PR 正文附上检查和审阅结果">
            <Toggle label="PR 正文附上检查和审阅结果" checked={pr.evidence} onChange={(evidence) => updatePr({ evidence })} />
          </Row>
          <Row label="新 PR 默认自动修复">
            <Toggle label="新 PR 默认自动修复" checked={pr.autoFix} onChange={(autoFix) => updatePr({ autoFix })} />
          </Row>
          <Row label="新 PR 默认检查通过后自动合并">
            <Toggle label="新 PR 默认检查通过后自动合并" checked={pr.mergeWhenGreen} onChange={(mergeWhenGreen) => updatePr({ mergeWhenGreen })} />
          </Row>
          <Row label="自动修复最多">
            <Segmented
              label="自动修复最多"
              value={String(pr.maxAutoFixes)}
              options={['1', '2', '3', '4', '5'].map((n) => ({ value: n, label: `${n} 次` }))}
              onChange={(n) => updatePr({ maxAutoFixes: Number(n) })}
            />
          </Row>
          <Row label="也处理这些机器人的评论">
            <BotsField value={pr.bots} onCommit={(bots) => updatePr({ bots })} />
          </Row>
          <Row label="写提交和 PR 的工具">
            <Segmented
              label="写提交和 PR 的工具"
              value={pr.writer}
              options={[
                { value: 'session', label: '同一会话' },
                { value: 'claude', label: 'Claude' },
                { value: 'codex', label: 'Codex' }
              ]}
              onChange={(writer) => updatePr({ writer })}
            />
          </Row>
          <Row label="Claude 写作模型">
            <ModelField label="Claude 写作模型" value={pr.writerClaudeModel} onCommit={(writerClaudeModel) => updatePr({ writerClaudeModel })} />
          </Row>
          <Row label="Codex 写作模型">
            <ModelField label="Codex 写作模型" value={pr.writerCodexModel} onCommit={(writerCodexModel) => updatePr({ writerCodexModel })} />
          </Row>
          <Row label="打开 PR 面板时自动写">
            <Toggle label="打开 PR 面板时自动写" checked={pr.writeOnOpen} onChange={(writeOnOpen) => updatePr({ writeOnOpen })} />
          </Row>
        </Section>
        <Section title="派活">
          <Row label="允许 agent 开新会话">
            <Toggle label="允许 agent 开新会话" checked={dispatch.tools} onChange={(tools) => updateDispatch({ tools })} />
          </Row>
          <Row label="开新会话时不再确认">
            <Toggle
              label="开新会话时不再确认"
              checked={dispatch.autoApprove}
              disabled={!dispatch.tools}
              onChange={(autoApprove) => updateDispatch({ autoApprove })}
            />
          </Row>
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
      aria-label="也处理这些机器人的评论"
      autoComplete="off"
      spellCheck={false}
      placeholder="无"
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
