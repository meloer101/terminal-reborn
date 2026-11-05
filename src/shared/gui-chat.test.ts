import { describe, expect, it } from 'vitest'
import { applyGuiEvent, composerPickers, emptyGuiState, matchCommands, type GuiConfigOption } from './gui-chat'

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
