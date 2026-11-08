import { describe, expect, it } from 'vitest'
import type { GuiConfigOption } from './gui-chat'
import { guiSettingChanges, guiSettings, parseSessionSettings, PLAN_VALUE } from './session-settings'

const claude: GuiConfigOption[] = [
  { id: 'model', category: 'model', label: '模型', current: 'opus', values: [{ value: 'opus', label: 'Opus 5.5' }, { value: 'sonnet', label: 'Sonnet 5.5' }] },
  { id: 'effort', category: 'thought_level', label: '思考程度', current: 'high', values: [{ value: 'low', label: '低' }, { value: 'high', label: '高' }] },
  { id: 'permission', category: 'permission', label: '权限', current: 'ask', values: [{ value: 'ask', label: '询问' }, { value: 'accept-edits', label: '接受编辑' }, { value: 'auto', label: '自动' }] },
  { id: 'plan', category: 'plan', label: '计划', current: 'off', values: [{ value: 'off', label: '关' }, { value: 'on', label: '开' }] }
]

describe('guiSettings', () => {
  it('maps the pickers by category, with 计划 before 自动 on the permission page', () => {
    const s = guiSettings(claude)
    expect(s?.items.map((i) => i.kind)).toEqual(['model', 'effort', 'permission'])
    expect(s?.items[2]?.values.map((v) => v.label)).toEqual(['询问', '接受编辑', '计划', '自动'])
    expect(s?.items[2]?.current).toBe('ask')
  })

  it('reads plan on as the current permission', () => {
    const on = claude.map((o) => (o.id === 'plan' ? { ...o, current: 'on' } : o))
    expect(guiSettings(on)?.items[2]?.current).toBe(PLAN_VALUE)
  })

  it('has nothing for a session without these pickers', () => {
    expect(guiSettings([])).toBeUndefined()
  })
})

describe('guiSettingChanges', () => {
  it('sets a value the picker offers', () => {
    expect(guiSettingChanges(claude, 'model', 'sonnet')).toEqual([{ option: 'model', value: 'sonnet' }])
    expect(guiSettingChanges(claude, 'effort', 'low')).toEqual([{ option: 'effort', value: 'low' }])
  })

  it('turns plan on, and off again before another level', () => {
    expect(guiSettingChanges(claude, 'permission', PLAN_VALUE)).toEqual([{ option: 'plan', value: 'on' }])
    const on = claude.map((o) => (o.id === 'plan' ? { ...o, current: 'on' } : o))
    expect(guiSettingChanges(on, 'permission', 'auto')).toEqual([{ option: 'plan', value: 'off' }, { option: 'permission', value: 'auto' }])
  })

  it('refuses a value the picker does not offer', () => {
    expect(guiSettingChanges(claude, 'model', 'gpt')).toBeNull()
    expect(guiSettingChanges([], 'permission', PLAN_VALUE)).toBeNull()
  })
})

describe('parseSessionSettings', () => {
  it('keeps a well-formed list and its flags', () => {
    const raw = { items: [{ kind: 'model', current: 'opus', values: [{ value: 'opus', label: 'Opus 5.5' }] }], locked: 'running' }
    expect(parseSessionSettings(raw)).toEqual(raw)
    expect(parseSessionSettings({ items: [], readOnly: true })).toEqual({ items: [], readOnly: true })
  })

  it('refuses anything off', () => {
    expect(parseSessionSettings({ items: [{ kind: 'speed', current: 'x', values: [] }] })).toBeNull()
    expect(parseSessionSettings({ items: [], locked: 'yes' })).toBeNull()
    expect(parseSessionSettings({ items: [{ kind: 'model', current: 'a\nb', values: [] }] })).toBeNull()
  })
})
