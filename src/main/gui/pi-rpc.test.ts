import { describe, expect, it } from 'vitest'
import type { GuiEvent, GuiState } from '@shared/gui-chat'
import { applyGuiEvent, emptyGuiState } from '@shared/gui-chat'
import { createPiNormalizer, piAnswerResponse, piBranchMessages, piCommands, piConfig, piHistoryItems, piThinkingLevels, waviConfirm } from './pi-rpc'

// Shapes as Pi 0.84.1 sends them (measured 2026-11-08 with DeepSeek V4).
const flash = { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek', reasoning: true, input: ['text'], thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', max: 'max' } }
const pro = { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek', reasoning: true, thinkingLevelMap: { xhigh: 'xhigh' } }
const plain = { id: 'chat', name: 'Chat', provider: 'x', reasoning: false }

const fold = (events: GuiEvent[], state: GuiState = emptyGuiState()): GuiState => events.reduce(applyGuiEvent, state)

describe('pickers', () => {
  it('lists models as provider/id with the chosen model’s thinking levels (T3 Code’s rule) and 询问 / 接受编辑', () => {
    expect(piThinkingLevels(flash)).toEqual(['off', 'high', 'max'])
    expect(piThinkingLevels(pro)).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
    expect(piThinkingLevels(plain)).toEqual([])
    const config = piConfig([flash, pro, plain], { model: 'deepseek/deepseek-v4-flash', effort: 'max', permission: 'accept-edits' })
    expect(config.map((o) => [o.id, o.current])).toEqual([['model', 'deepseek/deepseek-v4-flash'], ['effort', 'max'], ['permission', 'accept-edits']])
    expect(config[0]!.values[1]).toEqual({ value: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro' })
    expect(config[1]!.values.map((v) => v.label)).toEqual(['关', '高', '最高'])
    expect(config[2]!.values.map((v) => v.label)).toEqual(['询问', '接受编辑'])
  })

  it('takes the levels Pi reports for the running model over the model’s map', () => {
    expect(piConfig([flash], { effort: 'medium', permission: 'ask' }, ['off', 'medium'])[1]).toMatchObject({ current: 'medium', values: [{ value: 'off' }, { value: 'medium' }] })
  })

  it('falls back to high, then the first level; a model without reasoning has no 推理强度', () => {
    expect(piConfig([flash], { effort: 'xhigh', permission: 'ask' })[1]!.current).toBe('high')
    expect(piConfig([plain], { model: 'x/chat', permission: 'ask' }).map((o) => o.id)).toEqual(['model', 'permission'])
  })

  it('reads get_commands, skills apart', () => {
    expect(piCommands([{ name: 'llama', description: 'Manage', source: 'extension' }, { name: 'skill:lark', description: 'Lark', source: 'skill' }, { description: 'no name' }])).toEqual([
      { name: 'llama', description: 'Manage', kind: 'command' },
      { name: 'skill:lark', description: 'Lark', kind: 'skill' }
    ])
  })
})

describe('the stream', () => {
  it('streams text, folds it into an item, draws a bash row from start to end and ends the turn on agent_end', () => {
    const n = createPiNormalizer('/w', () => 1000)
    const events = [
      { type: 'agent_start' },
      { type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'run it' }] } },
      { type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: 0 } },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Sure' } },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' thing.' } }
    ].flatMap((e) => n.event(e))
    let state = fold(events)
    expect(state.busy).toBe(true)
    expect(state.live).toEqual({ kind: 'text', text: 'Sure thing.' })
    state = fold(
      [
        { type: 'message_update', assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'Sure thing.' } },
        { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: { command: 'cat a.txt' } },
        { type: 'tool_execution_update', toolCallId: 'c1', toolName: 'bash', partialResult: { content: [{ type: 'text', text: 'hel' }] } }
      ].flatMap((e) => n.event(e)),
      state
    )
    expect(state.live).toBeNull()
    expect(state.items.map((i) => i.kind)).toEqual(['user', 'text', 'tool'])
    expect(state.items[2]).toMatchObject({ name: 'Bash', arg: 'cat a.txt', input: 'cat a.txt', state: 'running', output: 'hel' })
    state = fold(
      [
        { type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', result: { content: [{ type: 'text', text: 'hello\n' }] }, isError: false },
        { type: 'agent_end', messages: [] }
      ].flatMap((e) => n.event(e)),
      state
    )
    expect(state.items[2]).toMatchObject({ state: 'ok', output: 'hello' })
    expect(state.busy).toBe(false)
  })

  it('keeps the turn running through a retry; says when it was aborted or failed', () => {
    const n = createPiNormalizer('/w', () => 0)
    expect(n.event({ type: 'agent_end', willRetry: true })).toEqual([])
    const state = fold([
      ...n.event({ type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'aborted' } }),
      ...n.event({ type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: '402 Insufficient Balance' } })
    ])
    expect(state.items.map((i) => (i.kind === 'system' ? i.text : i.kind))).toEqual(['已中断', '402 Insufficient Balance'])
  })

  it('an edit row shows the change from its arguments, then Pi’s own patch with the file’s line numbers', () => {
    const n = createPiNormalizer('/w', () => 0)
    let state = fold(n.event({ type: 'tool_execution_start', toolCallId: 'e', toolName: 'edit', args: { path: '/w/src/a.ts', edits: [{ oldText: 'a\nb', newText: 'a\nc' }] } }))
    expect(state.items[0]).toMatchObject({ name: 'Edit', arg: 'src/a.ts', diff: { path: 'src/a.ts', added: 1, removed: 1 } })
    const patch = '--- src/a.ts\n+++ src/a.ts\n@@ -10,2 +10,2 @@\n a\n-b\n+c\n'
    state = fold(n.event({ type: 'tool_execution_end', toolCallId: 'e', toolName: 'edit', result: { content: [{ type: 'text', text: 'ok' }], details: { patch } } }), state)
    const item = state.items[0]
    expect(item?.kind === 'tool' && item.diff?.hunks[0]?.oldStart).toBe(10)
  })
})

describe('what Pi waits on', () => {
  const confirm = (tool: string, input: unknown) => ({ type: 'extension_ui_request', id: 'q1', method: 'confirm', title: `Allow ${tool}?`, message: JSON.stringify({ wavi: 1, tool, input }) })

  it('Wavi’s confirm is a permission card: the command, or the change a write would make', () => {
    expect(waviConfirm(confirm('bash', { command: 'ls' }))).toEqual({ tool: 'bash', input: { command: 'ls' } })
    expect(waviConfirm({ method: 'confirm', message: 'not json' })).toBeNull()
    const n = createPiNormalizer('/w', () => 0)
    const [bash] = fold(n.request(confirm('bash', { command: 'rm -rf build' }))).prompts
    expect(bash).toMatchObject({ kind: 'permission', tool: 'Bash', detail: 'rm -rf build' })
    expect(bash?.kind === 'permission' && bash.options.map((o) => o.label)).toEqual(['拒绝', '总是允许', '允许'])
    const write = fold(n.request({ ...confirm('write', { path: '/w/new.md', content: 'x\ny\n' }), id: 'q2' })).prompts[0]
    expect(write).toMatchObject({ tool: 'Write', detail: 'new.md', diff: { path: 'new.md', added: 2, removed: 0 } })
    expect(piAnswerResponse(n.pending('q1')!, { kind: 'permission', id: 'q1', optionId: 'allow' })).toEqual({ confirmed: true })
    expect(piAnswerResponse(n.pending('q1')!, { kind: 'permission', id: 'q1', optionId: 'reject' })).toEqual({ confirmed: false })
  })

  it('another extension’s dialogs are questions; notifications wait on nothing', () => {
    const n = createPiNormalizer('/w', () => 0)
    const state = fold([
      ...n.request({ type: 'extension_ui_request', id: 'c', method: 'confirm', title: 'Trust?', message: 'Load .pi/ext.ts' }),
      ...n.request({ type: 'extension_ui_request', id: 's', method: 'select', title: 'Pick one', options: ['A', 'B'] }),
      ...n.request({ type: 'extension_ui_request', id: 'n', method: 'notify', message: 'hi' })
    ])
    expect(state.prompts.map((p) => (p.kind === 'question' ? [p.questions[0]!.question, p.questions[0]!.options.map((o) => o.label)] : null))).toEqual([
      ['Trust?\n\nLoad .pi/ext.ts', ['是', '否']],
      ['Pick one', ['A', 'B']]
    ])
    expect(piAnswerResponse(n.pending('c')!, { kind: 'question', id: 'c', answers: { 'Trust?\n\nLoad .pi/ext.ts': '是' } })).toEqual({ confirmed: true })
    expect(piAnswerResponse(n.pending('s')!, { kind: 'question', id: 's', answers: { 'Pick one': 'B' } })).toEqual({ value: 'B' })
    expect(piAnswerResponse(n.pending('s')!, { kind: 'question', id: 's', answers: {} })).toEqual({ cancelled: true })
    // A long option is shown clipped; the extension gets it back as it wrote it.
    const long = 'x'.repeat(400)
    const card = fold(n.request({ type: 'extension_ui_request', id: 'l', method: 'select', title: 'Long', options: [long] })).prompts[0]
    const shownLabel = card?.kind === 'question' ? card.questions[0]!.options[0]!.label : ''
    expect(shownLabel).toHaveLength(301)
    expect(piAnswerResponse(n.pending('l')!, { kind: 'question', id: 'l', answers: { Long: shownLabel } })).toEqual({ value: long })
    expect(n.waitingCalls()).toEqual([])
  })

  it('the end of the turn takes its prompts with it', () => {
    const n = createPiNormalizer('/w', () => 0)
    const state = fold([...n.request(confirm('bash', { command: 'x' })), ...n.event({ type: 'agent_end' })])
    expect(state.prompts).toEqual([])
    expect(n.pending('q1')).toBeUndefined()
  })
})

describe('a conversation read back', () => {
  const line = (v: unknown) => JSON.stringify(v)
  const file = [
    line({ type: 'session', version: 3, id: 'f28a', cwd: '/w' }),
    line({ type: 'model_change', id: 'm', parentId: null, provider: 'deepseek', modelId: 'deepseek-v4-flash' }),
    line({ type: 'message', id: 'u1', parentId: 'm', message: { role: 'user', content: [{ type: 'text', text: 'first try' }], timestamp: 1 } }),
    line({ type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant', content: [{ type: 'text', text: 'dropped' }] } }),
    // A branch from the model change: the active one, being last.
    line({ type: 'message', id: 'u2', parentId: 'm', message: { role: 'user', content: [{ type: 'text', text: 'read it' }], timestamp: 2 } }),
    line({ type: 'message', id: 'a2', parentId: 'u2', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'toolCall', id: 'c', name: 'read', arguments: { path: '/w/a.txt' } }] } }),
    line({ type: 'message', id: 'r', parentId: 'a2', message: { role: 'toolResult', toolCallId: 'c', toolName: 'read', content: [{ type: 'text', text: 'hello' }], isError: false } }),
    'not json',
    line({ type: 'message', id: 'a3', parentId: 'r', message: { role: 'assistant', content: [{ type: 'text', text: 'It says hello.' }] } })
  ]

  it('keeps the active branch only, a tool row with its result', () => {
    const items = piHistoryItems(piBranchMessages(file), '/w')
    expect(items.map((i) => [i.kind, i.kind === 'tool' ? `${i.name} ${i.arg} ${i.output}` : 'text' in i ? i.text : ''])).toEqual([
      ['user', 'read it'],
      ['thinking', 'hmm'],
      ['tool', 'Read a.txt hello'],
      ['text', 'It says hello.']
    ])
  })

  it('reads a file cut at the start (its newest part) up to where the read began', () => {
    expect(piHistoryItems(piBranchMessages(file.slice(6)), '/w').map((i) => i.kind)).toEqual(['text'])
  })
})

describe('finding the session file', () => {
  it('looks in the folder Pi names after the working folder first, then in every folder', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { piSessionFileFor, piSessionFolder } = await import('./history')
    const root = mkdtempSync(join(tmpdir(), 'pi-sessions-'))
    expect(piSessionFolder('/Users/m/a:b')).toBe('--Users-m-a-b--')
    mkdirSync(join(root, piSessionFolder('/w/p')))
    writeFileSync(join(root, piSessionFolder('/w/p'), '2026-11-08T14-14-42-627Z_abc.jsonl'), '')
    mkdirSync(join(root, '--elsewhere--'))
    writeFileSync(join(root, '--elsewhere--', '2026-11-08T00-00-00-000Z_def.jsonl'), '')
    expect(await piSessionFileFor('abc', root, '/w/p')).toBe(join(root, piSessionFolder('/w/p'), '2026-11-08T14-14-42-627Z_abc.jsonl'))
    expect(await piSessionFileFor('def', root, '/w/p')).toBe(join(root, '--elsewhere--', '2026-11-08T00-00-00-000Z_def.jsonl'))
    expect(await piSessionFileFor('nope', root)).toBeNull()
  })
})
