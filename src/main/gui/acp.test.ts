import { describe, expect, it } from 'vitest'
import { applyGuiEvent, emptyGuiState, type GuiConfigOption, type GuiEvent, type GuiState } from '@shared/gui-chat'
import { acpAnswerResult, acpAutoAllow, acpCommands, acpConfig, acpConfigRequest, acpPickers, acpPlanValue, createAcpNormalizer } from './acp'

// Shapes per the Agent Client Protocol (protocolVersion 1), as Grok `agent stdio` and Cursor `agent acp` send them (PRD §6.17).
const fold = (events: GuiEvent[], state: GuiState = emptyGuiState()) => events.reduce(applyGuiEvent, state)
const chunk = (sessionUpdate: string, text: string) => ({ sessionUpdate, content: { type: 'text', text } })

describe('createAcpNormalizer', () => {
  it('names the files of the pictures a message carries (Figma 71A)', () => {
    const s = fold(createAcpNormalizer('/repo', () => 3).sent('m1', 'look', 1, ['/tmp/a.png']))
    expect(s.items[0]).toMatchObject({ kind: 'user', images: 1, attachments: ['/tmp/a.png'] })
  })

  it('streams chunks live and finishes the block when a tool call or the prompt end arrives', () => {
    const n = createAcpNormalizer('/repo', () => 3)
    let s = fold(n.sent('m1', 'fix it', 0))
    expect(s).toMatchObject({ busy: true, items: [{ kind: 'user', id: 'm1', text: 'fix it' }] })
    expect(s.items[0]).not.toHaveProperty('attachments')
    s = fold([...n.update(chunk('agent_thought_chunk', 'Look')), ...n.update(chunk('agent_thought_chunk', 'ing'))], s)
    expect(s.live).toEqual({ kind: 'thinking', text: 'Looking' })
    s = fold(n.update(chunk('agent_message_chunk', 'On it.')), s)
    expect(s.items[1]).toMatchObject({ kind: 'thinking', text: 'Looking' })
    expect(s.live).toEqual({ kind: 'text', text: 'On it.' })
    s = fold(n.update({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Run tests', kind: 'execute', status: 'pending' }), s)
    expect(s.items.slice(2)).toEqual([
      { kind: 'text', id: 't1', at: 3, text: 'On it.' },
      { kind: 'tool', id: 'c1', at: 3, name: 'Bash', arg: 'Run tests', state: 'running' }
    ])
    s = fold(n.update({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: '12 passed' } }] }), s)
    expect(s.items[3]).toMatchObject({ state: 'ok', output: '12 passed', name: 'Bash', arg: 'Run tests' })
    s = fold(n.update(chunk('agent_message_chunk', 'Done.')), s)
    s = fold(n.promptDone('end_turn'), s)
    expect(s).toMatchObject({ busy: false, live: null })
    expect(s.items.at(-1)).toMatchObject({ kind: 'text', text: 'Done.' })
  })

  it('draws an edit from its old and new text, with the path relative to the session', () => {
    const n = createAcpNormalizer('/repo', () => 0)
    const s = fold(
      n.update({
        sessionUpdate: 'tool_call',
        toolCallId: 'e1',
        title: 'Edit file',
        kind: 'edit',
        status: 'completed',
        locations: [{ path: '/repo/src/a.ts' }],
        content: [{ type: 'diff', path: '/repo/src/a.ts', oldText: 'a\nb\nc\n', newText: 'a\nB\nc\n' }]
      })
    )
    expect(s.items[0]).toMatchObject({ name: 'Edit', arg: 'src/a.ts', diff: { path: 'src/a.ts', added: 1, removed: 1, hunks: [{ lines: [' a', '-b', '+B', ' c'] }] } })
  })

  it('keeps each file of a several-file edit apart', () => {
    const n = createAcpNormalizer('/repo', () => 0)
    const s = fold(
      n.update({
        sessionUpdate: 'tool_call',
        toolCallId: 'e2',
        kind: 'edit',
        status: 'completed',
        locations: [{ path: '/repo/src/a.ts' }, { path: '/repo/src/b.ts' }],
        content: [
          { type: 'diff', path: '/repo/src/a.ts', oldText: 'a\n', newText: 'A\n' },
          { type: 'diff', path: '/repo/src/b.ts', oldText: null, newText: 'b\nc\n' }
        ]
      })
    )
    expect(s.items[0]).toMatchObject({ diff: { path: 'src/a.ts', added: 1, removed: 1 } })
    const item = s.items[0]
    expect(item?.kind === 'tool' && item.files?.map((f) => [f.path, f.added, f.removed])).toEqual([
      ['src/a.ts', 1, 1],
      ['src/b.ts', 2, 0]
    ])
  })

  it('turns a permission request into a prompt with the agent’s options and marks a cancelled turn', () => {
    const n = createAcpNormalizer('/repo', () => 0)
    let s = fold(
      n.request('5', {
        toolCall: { toolCallId: 'c2', title: 'rm -rf build', kind: 'execute', status: 'pending' },
        options: [
          { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
          { optionId: 'always', name: 'Always', kind: 'allow_always' },
          { optionId: 'no', name: 'Reject', kind: 'reject_once' }
        ]
      })
    )
    const prompt = s.prompts[0]
    expect(prompt?.kind === 'permission' && prompt.options.map((o) => [o.id, o.label])).toEqual([
      ['no', '拒绝'],
      ['always', '总是允许'],
      ['yes', '允许']
    ])
    expect(acpAnswerResult(n.pending('5')!, { kind: 'permission', id: '5', optionId: 'always' })).toEqual({ outcome: { outcome: 'selected', optionId: 'always' } })
    expect(acpAnswerResult(n.pending('5')!, { kind: 'permission', id: '5', optionId: 'bogus' })).toEqual({ outcome: { outcome: 'cancelled' } })
    s = fold(n.promptDone('cancelled'), s)
    expect(s.prompts).toEqual([])
    expect(s.items.at(-1)).toMatchObject({ kind: 'system', text: '已中断' })
  })

  it('keeps the pictures of a replayed message as files (session/load, Figma 71A)', () => {
    const n = createAcpNormalizer('/repo', () => 0, (image) => `/kept/${image.data}.png`)
    let s = fold(n.update(chunk('user_message_chunk', '看图')))
    s = fold(n.update({ sessionUpdate: 'user_message_chunk', content: { type: 'image', data: 'AAAA', mimeType: 'image/png' } }), s)
    expect(s.items).toEqual([{ kind: 'user', id: 'u0', at: 0, text: '看图', images: 1, attachments: ['/kept/AAAA.png'] }])
  })

  it('joins the chunks of one replayed message into one bubble (session/load)', () => {
    const n = createAcpNormalizer('/repo', () => 0)
    let s = fold(n.update(chunk('user_message_chunk', 'Fix the ')))
    s = fold(n.update(chunk('user_message_chunk', 'login bug')), s)
    s = fold(n.update(chunk('agent_message_chunk', 'Done.')), s)
    s = fold(n.update(chunk('user_message_chunk', 'Thanks')), s)
    s = fold(n.promptDone('end_turn'), s)
    expect(s.items.map((i) => (i.kind === 'user' || i.kind === 'text' ? [i.kind, i.text] : [i.kind]))).toEqual([
      ['user', 'Fix the login bug'],
      ['text', 'Done.'],
      ['user', 'Thanks']
    ])
  })

  it('shows why a prompt failed', () => {
    const n = createAcpNormalizer('/repo', () => 0)
    const s = fold(n.promptDone(undefined, 'Internal error: quota exceeded'))
    expect(s.items).toEqual([{ kind: 'system', id: 's0', at: 0, text: 'Internal error: quota exceeded' }])
    expect(s.busy).toBe(false)
  })

  it('shows the plan as one row that updates in place within a turn, and a new row after the next message', () => {
    const n = createAcpNormalizer('/repo', () => 0)
    let s = fold(n.update({ sessionUpdate: 'plan', entries: [{ content: 'Read', status: 'completed' }, { content: 'Edit', status: 'in_progress' }] }))
    s = fold(n.update({ sessionUpdate: 'plan', entries: [{ content: 'Read', status: 'completed' }, { content: 'Edit', status: 'completed' }] }), s)
    expect(s.items).toEqual([
      {
        kind: 'tool',
        id: 'plan0',
        at: 0,
        name: 'Plan',
        arg: '2 项',
        state: 'ok',
        todos: [
          { text: 'Read', status: 'completed' },
          { text: 'Edit', status: 'completed' }
        ]
      }
    ])
    s = fold(n.sent('m1', 'and the tests', 0), s)
    s = fold(n.update({ sessionUpdate: 'plan', entries: [{ content: 'Test', status: 'pending' }] }), s)
    s = fold(n.update(chunk('user_message_chunk', 'replayed')), s)
    s = fold(n.update({ sessionUpdate: 'plan', entries: [{ content: 'Lint', status: 'pending' }] }), s)
    expect(s.items.map((i) => (i.kind === 'tool' ? i.todos?.map((t) => t.text).join(',') : i.kind))).toEqual(['Read,Edit', 'user', 'Test', 'user', 'Lint'])
  })
})

describe('acpConfig / acpConfigRequest / acpCommands', () => {
  it('reads configOptions by category (Grok: model + effort)', () => {
    const config = acpConfig({
      configOptions: [
        { id: 'model', type: 'select', category: 'model', currentValue: 'grok-4.6', options: [{ value: 'grok-4.6', name: 'Grok 4.6' }, { value: 'grok-4.5' }] },
        { id: 'reasoning_effort', type: 'select', category: 'thought_level', currentValue: 'high', options: [{ value: 'high' }, { value: 'low' }] }
      ]
    })
    expect(config.map((c) => [c.id, c.category, c.current])).toEqual([
      ['model', 'model', 'grok-4.6'],
      ['reasoning_effort', 'thought_level', 'high']
    ])
    expect(config[0]?.values[0]).toEqual({ value: 'grok-4.6', label: 'Grok 4.6' })
    expect(acpConfigRequest('s1', config[1]!, 'low', true)).toEqual({ method: 'session/set_config_option', params: { sessionId: 's1', configId: 'reasoning_effort', value: 'low' } })
  })

  it('falls back to the older modes / models fields', () => {
    const config = acpConfig({ modes: { currentModeId: 'agent', availableModes: [{ id: 'agent', name: 'Agent' }, { id: 'plan', name: 'Plan' }] }, models: { currentModelId: 'm1', availableModels: [{ modelId: 'm1', name: 'M1' }] } })
    expect(config.map((c) => [c.id, c.current])).toEqual([
      ['model', 'm1'],
      ['mode', 'agent']
    ])
    expect(acpConfigRequest('s1', config[1]!, 'plan', false)).toEqual({ method: 'session/set_mode', params: { sessionId: 's1', modeId: 'plan' } })
  })

  it('lists commands with their input hint', () => {
    expect(acpCommands([{ name: 'compact', description: 'Compact', input: { hint: '[focus]' } }, { description: 'x' }])).toEqual([{ name: 'compact', description: 'Compact', argumentHint: '[focus]', kind: 'command' }])
  })
})

describe('Figma 56 pickers', () => {
  const mode = (values: string[], current: string): GuiConfigOption => ({ id: 'mode', category: 'mode', label: 'Mode', current, values: values.map((value) => ({ value, label: value })) })

  it('takes a plan mode out of the agent’s modes, also a namespaced one, and drops a list left with one entry', () => {
    expect(acpPlanValue(mode(['code', 'agent#architect'], 'code'))).toBe('agent#architect')
    const state = { levels: ['ask', 'accept-edits'] as const, permission: 'ask' as const }
    expect(acpPickers([mode(['default', 'plan'], 'plan')], state).map((c) => `${c.id}=${c.current}`)).toEqual(['permission=ask', 'plan=on'])
    expect(acpPickers([mode(['a', 'b'], 'a')], state).map((c) => c.id)).toEqual(['mode', 'permission'])
  })

  it('lets only file changes through under 接受编辑, with the allow-once option', () => {
    const request = (kind: string) => ({ toolCall: { kind }, options: [{ optionId: 'always', kind: 'allow_always' }, { optionId: 'once', kind: 'allow_once' }] })
    expect(acpAutoAllow(request('edit'), 'accept-edits')).toBe('once')
    expect(acpAutoAllow(request('move'), 'accept-edits')).toBe('once')
    expect(acpAutoAllow(request('execute'), 'accept-edits')).toBeNull()
    expect(acpAutoAllow(request('edit'), 'ask')).toBeNull()
  })
})
