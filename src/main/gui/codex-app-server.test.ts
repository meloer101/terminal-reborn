import { describe, expect, it } from 'vitest'
import { applyGuiEvent, emptyGuiState, type GuiEvent, type GuiState } from '@shared/gui-chat'
import { codexAnswerResult, codexConfig, codexTurnParams, createCodexNormalizer, hunksOfUnifiedDiff } from './codex-app-server'

// Shapes as `codex app-server` 0.166.0 sends them (PRD §6.17, generated types `codex app-server generate-ts`).
const fold = (events: GuiEvent[], state: GuiState = emptyGuiState()) => events.reduce(applyGuiEvent, state)

describe('createCodexNormalizer', () => {
  it('streams an agent message and replaces it with the finished item', () => {
    const n = createCodexNormalizer('/repo', () => 7)
    let s = fold(n.notification('turn/started', { turn: { id: 't1' } }))
    s = fold(n.notification('item/started', { item: { type: 'agentMessage', id: 'm1', text: '' } }), s)
    s = fold(n.notification('item/agentMessage/delta', { itemId: 'm1', delta: 'po' }), s)
    s = fold(n.notification('item/agentMessage/delta', { itemId: 'm1', delta: 'ng' }), s)
    expect(s).toMatchObject({ busy: true, live: { kind: 'text', text: 'pong' } })
    s = fold(n.notification('item/completed', { item: { type: 'agentMessage', id: 'm1', text: 'pong', startedAtMs: 5 } }), s)
    expect(s.live).toBeNull()
    expect(s.items).toEqual([{ kind: 'text', id: 'm1', at: 5, text: 'pong' }])
    s = fold(n.notification('turn/completed', { turn: { id: 't1', status: 'completed' } }), s)
    expect(s.busy).toBe(false)
  })

  it('shows the user message, a command with its output and a file change with its diff', () => {
    const n = createCodexNormalizer('/repo', () => 0)
    const s = fold([
      ...n.notification('item/completed', { item: { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'Run ls' }, { type: 'localImage', path: '/a.png' }] } }),
      ...n.notification('item/started', { item: { type: 'commandExecution', id: 'c1', command: 'echo lab > a.txt', status: 'inProgress' } }),
      ...n.notification('item/completed', { item: { type: 'commandExecution', id: 'c1', command: 'echo lab > a.txt', status: 'completed', exitCode: 0, aggregatedOutput: '' } }),
      ...n.notification('item/completed', {
        item: { type: 'fileChange', id: 'f1', status: 'completed', changes: [{ path: '/repo/src/a.ts', kind: { type: 'update', move_path: null }, diff: '@@ -1,2 +1,2 @@\n a\n-b\n+c\n' }] }
      })
    ])
    expect(s.items[0]).toMatchObject({ kind: 'user', text: 'Run ls', images: 1 })
    expect(s.items[1]).toMatchObject({ kind: 'tool', name: 'Bash', arg: 'echo lab > a.txt', state: 'ok' })
    expect(s.items[2]).toMatchObject({ kind: 'tool', name: 'Edit', arg: 'src/a.ts', state: 'ok', diff: { added: 1, removed: 1 } })
  })

  it('turns approvals and questions into prompts and drops them once resolved', () => {
    const n = createCodexNormalizer('/repo')
    let s = fold(n.request('7', 'item/commandExecution/requestApproval', { command: 'rm -rf build', availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'] }))
    s = fold(n.request('8', 'item/fileChange/requestApproval', { reason: 'write b.txt' }), s)
    s = fold(n.request('9', 'item/tool/requestUserInput', { questions: [{ id: 'q1', header: 'Color', question: 'Which?', options: [{ label: 'Red', description: '' }] }] }), s)
    expect(s.prompts.map((p) => p.kind)).toEqual(['permission', 'permission', 'question'])
    const [cmd] = s.prompts
    expect(cmd?.kind === 'permission' && cmd.options.map((o) => o.label)).toEqual(['拒绝', '总是允许', '允许'])
    s = fold(n.notification('serverRequest/resolved', { requestId: 7 }), s)
    expect(s.prompts.map((p) => p.id)).toEqual(['8', '9'])
  })

  it('keeps retries out of the conversation and shows a final error', () => {
    const n = createCodexNormalizer('/repo', () => 0)
    expect(n.notification('error', { error: { message: 'Reconnecting... 1/5' }, willRetry: true })).toEqual([])
    expect(fold(n.notification('error', { error: { message: 'unexpected status 503' }, willRetry: false })).items[0]).toMatchObject({ kind: 'system', text: 'unexpected status 503' })
  })
})

describe('codexAnswerResult', () => {
  it('maps the chosen option to a decision and question answers to their ids', () => {
    expect(codexAnswerResult({ id: '7', method: 'item/commandExecution/requestApproval', params: {} }, { kind: 'permission', id: '7', optionId: 'acceptForSession' })).toEqual({
      decision: 'acceptForSession'
    })
    expect(
      codexAnswerResult({ id: '9', method: 'item/tool/requestUserInput', params: { questions: [{ id: 'q1', question: 'Which?' }] } }, { kind: 'question', id: '9', answers: { 'Which?': 'Red' } })
    ).toEqual({ answers: { q1: { answers: ['Red'] } } })
  })
})

describe('codexConfig / codexTurnParams', () => {
  const models = [
    { id: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }], defaultReasoningEffort: 'high' },
    { id: 'hidden', hidden: true }
  ]

  it('offers visible models, the chosen one’s efforts and the approval presets, and applies them per turn', () => {
    const config = codexConfig(models, {})
    expect(config.map((c) => [c.id, c.current])).toEqual([
      ['model', 'gpt-6.1-sol'],
      ['effort', 'high'],
      ['mode', 'on-request']
    ])
    expect(codexTurnParams('th', 'hi', config, ['/a.png'])).toEqual({
      threadId: 'th',
      input: [{ type: 'text', text: 'hi', text_elements: [] }, { type: 'localImage', path: '/a.png' }],
      model: 'gpt-6.1-sol',
      effort: 'high',
      approvalPolicy: 'on-request'
    })
  })
})

describe('hunksOfUnifiedDiff', () => {
  it('reads hunk heads and body lines, skipping file headers and no-newline markers', () => {
    expect(hunksOfUnifiedDiff('--- a/x\n+++ b/x\n@@ -3 +3,2 @@\n-a\n+b\n+c\n\\ No newline at end of file\n')).toEqual([{ oldStart: 3, newStart: 3, lines: ['-a', '+b', '+c'] }])
  })
})
