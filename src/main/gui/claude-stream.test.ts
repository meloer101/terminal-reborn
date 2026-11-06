import { describe, expect, it } from 'vitest'
import { applyGuiEvent, emptyGuiState, type GuiEvent, type GuiState } from '@shared/gui-chat'
import { claudeAnswerResponse, claudeConfig, claudeConfigRequest, commandsOf, createClaudeStreamNormalizer } from './claude-stream'

// Shapes as `claude -p --output-format stream-json --include-partial-messages` 2.1.317 prints them (PRD §6.17).
const at = '2026-11-05T15:54:30.000Z'
const delta = (text: string, parent: string | null = null) => ({
  type: 'stream_event',
  parent_tool_use_id: parent,
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
})
const start = (kind: 'text' | 'thinking' | 'tool_use') => ({
  type: 'stream_event',
  parent_tool_use_id: null,
  event: { type: 'content_block_start', index: 0, content_block: kind === 'tool_use' ? { type: 'tool_use', id: 'x', name: 'Read', input: {} } : { type: kind, [kind]: '' } }
})
const assistant = (content: unknown[], parent: string | null = null) => ({
  type: 'assistant',
  parent_tool_use_id: parent,
  uuid: 'a1',
  timestamp: at,
  message: { id: 'msg_1', role: 'assistant', content }
})

function run(lines: Record<string, unknown>[], cwd = '/repo'): { state: GuiState; events: GuiEvent[] } {
  const n = createClaudeStreamNormalizer(cwd, () => 0)
  const events = lines.flatMap((l) => n.push(l))
  return { state: events.reduce(applyGuiEvent, emptyGuiState()), events }
}

describe('createClaudeStreamNormalizer', () => {
  it('streams a text block live and replaces it with the finished item', () => {
    const n = createClaudeStreamNormalizer('/repo', () => 0)
    let state = emptyGuiState()
    for (const l of [start('text'), delta('已'), delta('完成')]) state = n.push(l).reduce(applyGuiEvent, state)
    expect(state.live).toEqual({ kind: 'text', text: '已完成' })
    state = n.push(assistant([{ type: 'text', text: '已完成。' }])).reduce(applyGuiEvent, state)
    expect(state.live).toBeNull()
    expect(state.items).toEqual([{ kind: 'text', id: 't0', at: Date.parse(at), text: '已完成。' }])
  })

  it('shows the user message Claude replays, and a tool call with its result and diff', () => {
    const { state } = run([
      { type: 'user', uuid: 'u1', timestamp: at, isReplay: true, parent_tool_use_id: null, message: { role: 'user', content: 'Change line2' } },
      assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/repo/notes.txt', old_string: 'line2', new_string: 'line-two' } }]),
      {
        type: 'user',
        timestamp: at,
        parent_tool_use_id: null,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
        tool_use_result: { filePath: '/repo/notes.txt', structuredPatch: [{ oldStart: 2, newStart: 2, lines: ['-line2', '+line-two'] }] }
      }
    ])
    expect(state.items[0]).toMatchObject({ kind: 'user', text: 'Change line2' })
    expect(state.items[1]).toMatchObject({ kind: 'tool', name: 'Edit', arg: 'notes.txt', state: 'ok', diff: { path: 'notes.txt', added: 1, removed: 1 } })
  })

  it("leaves a subagent's own stream and messages out of the conversation", () => {
    const { state } = run([start('text'), delta('inner', 'toolu_agent'), assistant([{ type: 'text', text: 'inner' }], 'toolu_agent')])
    expect(state.items).toEqual([])
    expect(state.live).toEqual({ kind: 'text', text: '' })
  })

  it('turns can_use_tool into permission, question and plan prompts', () => {
    const { state } = run([
      { type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'pnpm test' }, permission_suggestions: [{ type: 'addRules' }] } },
      { type: 'control_request', request_id: 'r2', request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: '/repo/a.txt' }, permission_suggestions: [] } },
      {
        type: 'control_request',
        request_id: 'r3',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'AskUserQuestion',
          input: { questions: [{ question: 'Which color?', header: 'Color', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue', description: 'calm' }] }] }
        }
      },
      { type: 'control_request', request_id: 'r4', request: { subtype: 'can_use_tool', tool_name: 'ExitPlanMode', input: { plan: '1. a\n2. b', planFilePath: '/p.md' } } }
    ])
    expect(state.prompts.map((p) => p.kind)).toEqual(['permission', 'permission', 'question', 'plan'])
    const [bash, write, question, plan] = state.prompts
    expect(bash).toMatchObject({ tool: 'Bash', detail: 'pnpm test' })
    expect(write).toMatchObject({ tool: 'Write', detail: 'a.txt' })
    expect(bash?.kind === 'permission' && bash.options.map((o) => o.label)).toEqual(['拒绝', '总是允许', '允许'])
    expect(write?.kind === 'permission' && write.options.map((o) => o.kind)).toEqual(['reject_once', 'allow_once'])
    expect(question).toMatchObject({ questions: [{ question: 'Which color?', header: 'Color', options: [{ label: 'Red' }, { label: 'Blue', description: 'calm' }] }] })
    expect(plan).toMatchObject({ plan: '1. a\n2. b' })
  })

  it('offers 总是允许 only when a suggestion survives the filter (no setMode, nothing for userSettings)', () => {
    const request = (id: string, permission_suggestions: unknown[]) => ({
      type: 'control_request',
      request_id: id,
      request: { subtype: 'can_use_tool', tool_name: 'Edit', input: { file_path: '/repo/a.txt' }, permission_suggestions }
    })
    const { state } = run([
      request('r1', [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]),
      request('r2', [{ type: 'addRules', rules: [{ toolName: 'Edit' }], behavior: 'allow', destination: 'userSettings' }])
    ])
    for (const prompt of state.prompts) expect(prompt.kind === 'permission' && prompt.options.map((o) => o.kind)).toEqual(['reject_once', 'allow_once'])
  })

  it('ends the turn on result: the stream and the open prompts go', () => {
    const { state } = run([
      start('text'),
      delta('half'),
      { type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } } },
      { type: 'result', subtype: 'error_during_execution', is_error: true }
    ])
    expect(state).toMatchObject({ busy: false, live: null, prompts: [] })
  })

  it('updates the / menu when Claude reports changed commands, and ignores hook and status chatter', () => {
    const { events } = run([
      { type: 'system', subtype: 'hook_started', hook_event: 'SessionStart' },
      { type: 'system', subtype: 'status', status: 'requesting' },
      { type: 'system', subtype: 'commands_changed', commands: [{ name: 'review', description: 'Review the branch (user)', argumentHint: '' }] }
    ])
    expect(events).toEqual([{ type: 'commands', commands: [{ name: 'review', description: 'Review the branch' }] }])
  })
})

describe('claudeConfig', () => {
  const init = {
    current_permission_mode: 'default',
    models: [
      { value: 'default', displayName: 'Default (recommended)', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { value: 'haiku', displayName: 'Haiku 5.5', supportsEffort: false }
    ]
  }

  it('offers the models, the chosen model’s effort levels, 权限 and 计划 (Figma 56)', () => {
    const config = claudeConfig(init, { effort: 'medium' })
    expect(config.map((c) => [c.id, c.current])).toEqual([
      ['model', 'default'],
      ['effort', 'medium'],
      ['permission', 'ask'],
      ['plan', 'off']
    ])
    expect(config[1]?.values.map((v) => v.label)).toEqual(['低', '中', '高', '更高', '最高'])
    expect(config[2]?.values.map((v) => v.label)).toEqual(['询问', '接受编辑', '自动'])
  })

  it('reads Claude’s permission mode as a level, and plan as 计划 on with the level it returns to', () => {
    const pick = (state: Parameters<typeof claudeConfig>[1]) => claudeConfig(init, state).flatMap((c) => (c.id === 'permission' || c.id === 'plan' ? [c.current] : []))
    expect(pick({ mode: 'acceptEdits' })).toEqual(['accept-edits', 'off'])
    expect(pick({ mode: 'auto' })).toEqual(['auto', 'off'])
    expect(pick({ mode: 'plan', level: 'accept-edits' })).toEqual(['accept-edits', 'on'])
    expect(pick({ mode: 'bypassPermissions' })).toEqual(['ask', 'off'])
  })

  it('maps the resolved model a turn reports back to its alias (not to Default)', () => {
    const models = { models: [
      { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)' },
      { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5' },
      { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5' }
    ] }
    expect(claudeConfig(models, { model: 'claude-haiku-5-5' })[0]?.current).toBe('haiku')
    expect(claudeConfig(models, { model: 'claude-opus-5-5' })[0]?.current).toBe('opus')
    expect(claudeConfig(models, { model: 'default' })[0]?.current).toBe('default')
  })

  it('drops the effort picker for a model without effort', () => {
    expect(claudeConfig(init, { model: 'haiku' }).map((c) => c.id)).toEqual(['model', 'permission', 'plan'])
  })

  it('maps picker changes to control requests', () => {
    expect(claudeConfigRequest('model', 'opus')).toEqual({ subtype: 'set_model', model: 'opus' })
    expect(claudeConfigRequest('permission', 'accept-edits')).toEqual({ subtype: 'set_permission_mode', mode: 'acceptEdits' })
    expect(claudeConfigRequest('permission', 'auto')).toEqual({ subtype: 'set_permission_mode', mode: 'auto' })
    expect(claudeConfigRequest('permission', 'bypass')).toBeNull()
    expect(claudeConfigRequest('plan', 'on', 'auto')).toEqual({ subtype: 'set_permission_mode', mode: 'plan' })
    expect(claudeConfigRequest('plan', 'off', 'accept-edits')).toEqual({ subtype: 'set_permission_mode', mode: 'acceptEdits' })
    expect(claudeConfigRequest('effort', 'low')).toEqual({ subtype: 'apply_flag_settings', settings: { effortLevel: 'low' } })
    expect(claudeConfigRequest('other', 'x')).toBeNull()
  })
})

describe('claudeAnswerResponse', () => {
  const rule = { type: 'addRules', rules: [{ toolName: 'Edit' }], behavior: 'allow', destination: 'localSettings' }
  const pending = {
    requestId: 'r',
    tool: 'Edit',
    input: { file_path: '/a' },
    suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }, { ...rule, destination: 'userSettings' }, rule]
  }

  it('allows once, always (with Claude’s own safe suggestions) or denies with a reason', () => {
    expect(claudeAnswerResponse(pending, { kind: 'permission', id: 'r', optionId: 'allow_once' })).toEqual({ behavior: 'allow', updatedInput: { file_path: '/a' } })
    // No setMode (it switched the whole session) and nothing for userSettings (~/.claude/settings.json).
    expect(claudeAnswerResponse(pending, { kind: 'permission', id: 'r', optionId: 'allow_always' })).toMatchObject({ updatedPermissions: [rule] })
    expect(claudeAnswerResponse(pending, { kind: 'permission', id: 'r', optionId: 'reject_once', message: ' not now ' })).toEqual({ behavior: 'deny', message: 'not now' })
  })

  it('answers a question with answers keyed by the question text', () => {
    const q = { ...pending, tool: 'AskUserQuestion', input: { questions: [{ question: 'Which?' }] } }
    expect(claudeAnswerResponse(q, { kind: 'question', id: 'r', answers: { 'Which?': 'Blue' } })).toEqual({
      behavior: 'allow',
      updatedInput: { questions: [{ question: 'Which?' }], answers: { 'Which?': 'Blue' } }
    })
  })

  it('approves a plan into accept-edits or ask mode, or keeps planning', () => {
    const p = { ...pending, tool: 'ExitPlanMode', input: { plan: 'x' } }
    expect(claudeAnswerResponse(p, { kind: 'plan', id: 'r', decision: 'approve-auto' })).toMatchObject({ behavior: 'allow', updatedPermissions: [{ mode: 'acceptEdits' }] })
    expect(claudeAnswerResponse(p, { kind: 'plan', id: 'r', decision: 'approve-ask' })).toMatchObject({ updatedPermissions: [{ mode: 'default' }] })
    expect(claudeAnswerResponse(p, { kind: 'plan', id: 'r', decision: 'keep-planning' })).toEqual({ behavior: 'deny', message: 'Keep planning.' })
  })
})

describe('commandsOf', () => {
  it('keeps name, description and argument hint, without the source suffix', () => {
    expect(commandsOf([{ name: 'tdd', description: 'Test first (plugin:mattpocock)', argumentHint: '<file>' }, { description: 'nameless' }])).toEqual([
      { name: 'tdd', description: 'Test first', argumentHint: '<file>' }
    ])
  })
})
