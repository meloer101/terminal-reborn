import { describe, expect, it } from 'vitest'
import { applyGuiEvent, composerPickers, emptyGuiState, fastOption, matchCommands, permissionOption, picksOf, planOption, sanitizeGuiPicks, type GuiConfigOption } from './gui-chat'

describe('applyGuiEvent', () => {
  it('appends and replaces items by index and keeps untouched parts', () => {
    const s0 = emptyGuiState()
    const s1 = applyGuiEvent(s0, { type: 'items', changes: [{ index: 0, item: { kind: 'text', id: 't0', at: 1, text: 'a' } }] })
    const s2 = applyGuiEvent(s1, { type: 'items', changes: [{ index: 0, item: { kind: 'text', id: 't0', at: 1, text: 'b' } }, { index: 5, item: { kind: 'system', id: 's', at: 1, text: 'gap' } }] })
    expect(s2.items).toEqual([{ kind: 'text', id: 't0', at: 1, text: 'b' }])
    expect(s2.prompts).toBe(s0.prompts)
  })

  it('replaces a prompt with the same id and removes answered ones', () => {
    const prompt = { kind: 'plan' as const, id: 'p', plan: 'x' }
    let s = applyGuiEvent(emptyGuiState(), { type: 'prompt', prompt })
    s = applyGuiEvent(s, { type: 'prompt', prompt: { ...prompt, plan: 'y' } })
    expect(s.prompts).toEqual([{ kind: 'plan', id: 'p', plan: 'y' }])
    expect(applyGuiEvent(s, { type: 'prompt-done', id: 'p' }).prompts).toEqual([])
    expect(applyGuiEvent(s, { type: 'prompt-done', id: 'other' })).toBe(s)
  })

  it('clears the stream and open prompts when the turn ends', () => {
    let s = applyGuiEvent(emptyGuiState(), { type: 'busy', busy: true })
    s = applyGuiEvent(s, { type: 'live', live: { kind: 'text', text: 'half' } })
    s = applyGuiEvent(s, { type: 'prompt', prompt: { kind: 'plan', id: 'p', plan: '' } })
    expect(applyGuiEvent(s, { type: 'busy', busy: false })).toMatchObject({ busy: false, live: null, prompts: [] })
  })
})

describe('composerPickers', () => {
  const opt = (id: string, category: GuiConfigOption['category'], n = 2): GuiConfigOption => ({
    id,
    category,
    label: id,
    current: 'a',
    values: Array.from({ length: n }, (_, i) => ({ value: String(i), label: String(i) }))
  })

  it('orders model, effort, mode and drops pickers with one value', () => {
    expect(composerPickers([opt('mode', 'mode'), opt('fixed', 'other', 1), opt('effort', 'thought_level'), opt('model', 'model')]).map((o) => o.id)).toEqual([
      'model',
      'effort',
      'mode'
    ])
  })
})

describe('matchCommands', () => {
  const commands = ['review', 'rewind', 'pr-review', 'compact'].map((name) => ({ name, description: '' }))

  it('puts prefix matches before contained matches', () => {
    expect(matchCommands(commands, '/re').map((c) => c.name)).toEqual(['review', 'rewind', 'pr-review'])
    expect(matchCommands(commands, '/review').map((c) => c.name)).toEqual(['review', 'pr-review'])
    expect(matchCommands(commands, '/').map((c) => c.name)).toEqual(['review', 'rewind', 'pr-review', 'compact'])
  })
})

describe('agent picks (Figma 65)', () => {
  it('reads the picks a session runs with from its pickers', () => {
    const config = [
      { id: 'model', category: 'model' as const, label: '模型', current: 'opus', values: [{ value: 'opus', label: 'Opus' }] },
      { id: 'effort', category: 'thought_level' as const, label: '推理强度', current: 'high', values: [{ value: 'high', label: '高' }] },
      permissionOption(['ask', 'accept-edits', 'auto'], 'auto'),
      planOption(true),
      fastOption(true)
    ]
    expect(picksOf(config)).toEqual({ model: 'opus', models: [{ value: 'opus', label: 'Opus' }], effort: 'high', permission: 'auto', plan: true, fast: true })
    expect(picksOf([])).toEqual({})
  })

  it('keeps only known agents and well-formed values from disk', () => {
    const agents = new Set(['claude', 'codex'])
    expect(
      sanitizeGuiPicks({ claude: { model: 'opus', models: [{ value: 'opus', label: 'Opus 5.5' }, { value: 1 }], effort: 'max', permission: 'auto', plan: false, fast: true }, codex: { model: 'a b', permission: 'yolo', fast: 'on', models: 'x' }, nope: { model: 'x' } }, agents)
    ).toEqual({ claude: { model: 'opus', models: [{ value: 'opus', label: 'Opus 5.5' }], effort: 'max', permission: 'auto', plan: false, fast: true }, codex: {} })
    expect(sanitizeGuiPicks('x', agents)).toEqual({})
  })
})
