import { describe, expect, it } from 'vitest'
import {
  claudeFamily,
  claudeModelLabel,
  claudePermissionOnScreen,
  claudeTerminalSettings,
  effortOnPicker,
  effortPickerMoves,
  isSwitchModelPrompt,
  KEY,
  modelPickerMoves
} from './terminal-settings'

// Claude Code 2.1.319, captured in a PTY (PRD §6.16).
const MODEL_PICKER = `  Select model
  Switch between Claude models. Your pick becomes the default for new sessions.
  ❯ 1. Default (recommended) ✔  Use the default model (currently Opus 5.5) · $4/$20 per Mtok
    2. Opus                     Opus 5.5 · Best for everyday, complex tasks · $4/$20 per Mtok
    3. Fable                    Fable 5.1 · Most capable for your hardest and longest-running tasks
    4. Sonnet                   Sonnet 5.5 · Efficient for routine tasks · $2/$10 per Mtok
    5. Haiku                    Haiku 5.5 · Fastest for quick answers · $0.10/$0.50 per Mtok ($0.50/$2.50 for prompts
                                over 100k)
  ◐ Medium effort (default) ←/→ to adjust
  Enter to set as default · s to use this session only · Esc to cancel`

const EFFORT_PICKER = (arrow: number) => `   Effort
                             Faster                             Smarter
${' '.repeat(arrow)}▲
                             low     medium     high     xhigh      max      Tab to toggle
   ←/→ to adjust · Enter to confirm · s for this session only · Esc to cancel`

describe('Claude terminal settings', () => {
  it('names models as Claude reports them', () => {
    expect(claudeModelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(claudeModelLabel('claude-fable-5-1')).toBe('Fable 5.1')
    expect(claudeFamily('claude-sonnet-5-5')).toBe('sonnet')
    expect(claudeFamily('gpt-6')).toBeUndefined()
  })

  it('reads the permission mode off the footer', () => {
    expect(claudePermissionOnScreen('  SL\n  ⏵⏵ accept edits on (shift+tab to cycle)')).toBe('acceptEdits')
    expect(claudePermissionOnScreen('  ⏸ plan mode on (shift+tab to cycle)')).toBe('plan')
    expect(claudePermissionOnScreen('  ⏵⏵ auto mode on (shift+tab to cycle)')).toBe('auto')
    expect(claudePermissionOnScreen('  ⏸ manual mode on · ← for agents')).toBe('default')
    expect(claudePermissionOnScreen('❯ hello')).toBeNull()
  })

  it('lists the rows Claude reported, locked mid-turn, and leaves out what it has not reported', () => {
    const s = claudeTerminalSettings({ model: 'claude-sonnet-5-5', effort: 'high', permission: 'plan' }, true)
    expect(s?.items.map((i) => [i.kind, i.current])).toEqual([['model', 'sonnet'], ['effort', 'high'], ['permission', 'plan']])
    expect(s?.items[0]?.values.find((v) => v.value === 'sonnet')?.label).toBe('Sonnet 5.5')
    expect(s?.items[2]?.values.map((v) => v.label)).toEqual(['询问', '接受编辑', '计划', '自动'])
    expect(s?.locked).toBe('running')
    expect(claudeTerminalSettings({ effort: 'low' }, false)?.items.map((i) => i.kind)).toEqual(['effort'])
    expect(claudeTerminalSettings({}, false)).toBeUndefined()
  })

  it('moves the model picker from its cursor to the family', () => {
    expect(modelPickerMoves(MODEL_PICKER, 'sonnet')).toBe(KEY.down.repeat(3))
    expect(modelPickerMoves(MODEL_PICKER.replace('❯ 1.', '  1.').replace('    5. Haiku', '  ❯ 5. Haiku'), 'opus')).toBe(KEY.up.repeat(3))
    expect(modelPickerMoves(MODEL_PICKER, 'gpt')).toBeNull()
    expect(modelPickerMoves('❯ hello', 'opus')).toBeNull()
  })

  it('reads the effort under the ▲ and moves to the target', () => {
    expect(effortOnPicker(EFFORT_PICKER(39))).toBe('medium')
    expect(effortOnPicker(EFFORT_PICKER(49))).toBe('high')
    expect(effortPickerMoves(EFFORT_PICKER(39), 'xhigh')).toBe(KEY.right.repeat(2))
    expect(effortPickerMoves(EFFORT_PICKER(49), 'low')).toBe(KEY.left.repeat(2))
    expect(effortPickerMoves('nothing', 'low')).toBeNull()
  })

  it('knows the second question before a switch', () => {
    expect(isSwitchModelPrompt('Switch model?\n 1. Yes\n 2. No')).toBe(true)
  })
})
