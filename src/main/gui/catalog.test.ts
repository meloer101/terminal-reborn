import { describe, expect, it } from 'vitest'
import { claudeCatalog, codexCatalog, cursorCatalog, grokCatalog, piCatalog } from './catalog'

describe('model catalogs without a conversation (Figma 65)', () => {
  it('reads Claude’s initialize models, without Default', () => {
    const init = { models: [
      { value: 'default', displayName: 'Default (recommended)', resolvedModel: 'claude-opus-5-5' },
      { value: 'opus', displayName: 'Opus 5.5', resolvedModel: 'claude-opus-5-5' },
      { value: 'sonnet', displayName: 'Sonnet 5.5', resolvedModel: 'claude-sonnet-5-5' }
    ] }
    expect(claudeCatalog(init)).toEqual({ models: [{ value: 'opus', label: 'Opus 5.5' }, { value: 'sonnet', label: 'Sonnet 5.5' }], current: 'opus' })
  })

  it('reads Codex’s model/list, its default current', () => {
    expect(codexCatalog([{ id: 'gpt-a', displayName: 'GPT A' }, { id: 'gpt-b', displayName: 'GPT B', isDefault: true }, { id: 'h', hidden: true }])).toEqual({
      models: [{ value: 'gpt-a', label: 'GPT A' }, { value: 'gpt-b', label: 'GPT B' }],
      current: 'gpt-b'
    })
  })

  it('reads Grok’s ACP initialize _meta.modelState (no session/new)', () => {
    const result = { _meta: { modelState: { currentModelId: 'grok-4.7', availableModels: [{ modelId: 'grok-4.7', name: 'Grok 4.7' }, { modelId: 'grok-4.6' }] } } }
    expect(grokCatalog(result)).toEqual({ models: [{ value: 'grok-4.7', label: 'Grok 4.7' }, { value: 'grok-4.6', label: 'grok-4.6' }], current: 'grok-4.7' })
    expect(grokCatalog({})).toBeNull()
  })

  it('reads `cursor-agent models`', () => {
    const out = 'Available models\n\nauto - Auto (default)\ngpt-5.3-codex - Codex 5.3\nsonnet-4.6 - Sonnet 4.6 (current)\n\nTip: use --model\n'
    expect(cursorCatalog(out)).toEqual({
      models: [{ value: 'auto', label: 'Auto' }, { value: 'gpt-5.3-codex', label: 'Codex 5.3' }, { value: 'sonnet-4.6', label: 'Sonnet 4.6' }],
      current: 'sonnet-4.6'
    })
    expect(cursorCatalog('nothing here')).toBeNull()
  })

  it('reads Pi’s rpc get_available_models and get_state (provider/id, as --model takes it)', () => {
    const models = [{ provider: 'deepseek', id: 'deepseek-v4-flash' }, { provider: 'deepseek', id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }]
    expect(piCatalog(models, { model: { provider: 'deepseek', id: 'deepseek-v4-flash' } })).toEqual({
      models: [{ value: 'deepseek/deepseek-v4-flash', label: 'deepseek-v4-flash' }, { value: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro' }],
      current: 'deepseek/deepseek-v4-flash'
    })
  })
})
