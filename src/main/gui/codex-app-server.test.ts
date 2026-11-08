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

  it('keeps a command’s whole text and its exit code', () => {
    const n = createCodexNormalizer('/repo', () => 0)
    const command = "/bin/zsh -lc 'pnpm test\n  --run'"
    const s = fold([
      ...n.notification('item/started', { item: { type: 'commandExecution', id: 'c1', command, status: 'inProgress' } }),
      ...n.notification('item/completed', { item: { type: 'commandExecution', id: 'c1', command, status: 'failed', exitCode: 1, aggregatedOutput: 'FAIL' } }),
      ...n.notification('item/completed', { item: { type: 'commandExecution', id: 'c2', command: 'true', status: 'completed', exitCode: 0 } })
    ])
    expect(s.items[0]).toMatchObject({ kind: 'tool', name: 'Bash', arg: "/bin/zsh -lc 'pnpm test --run'", input: command, state: 'error', exit: 1 })
    expect(s.items[1]).toMatchObject({ state: 'ok', exit: 0, input: 'true' })
  })

  it('keeps each file of a change apart: the first as `diff`, all of them as `files`', () => {
    const n = createCodexNormalizer('/repo', () => 0)
    const s = fold(
      n.notification('item/completed', {
        item: {
          type: 'fileChange',
          id: 'f1',
          status: 'completed',
          changes: [
            { path: '/repo/src/a.ts', kind: { type: 'update', move_path: null }, diff: '@@ -1,2 +1,2 @@\n a\n-b\n+c\n' },
            { path: '/repo/src/new.ts', kind: { type: 'add' }, diff: 'x\ny\n' }
          ]
        }
      })
    )
    expect(s.items[0]).toMatchObject({ kind: 'tool', name: 'Edit', arg: 'src/a.ts 等 2 个文件', diff: { path: 'src/a.ts', added: 1, removed: 1 } })
    const item = s.items[0]
    expect(item?.kind === 'tool' && item.files?.map((f) => [f.path, f.added, f.removed])).toEqual([
      ['src/a.ts', 1, 1],
      ['src/new.ts', 2, 0]
    ])
    // One file: no `files`.
    const one = fold(createCodexNormalizer('/repo', () => 0).notification('item/completed', { item: { type: 'fileChange', id: 'f2', status: 'completed', changes: [{ path: '/repo/b.ts', kind: { type: 'add' }, diff: 'z\n' }] } }))
    expect(one.items[0]).not.toHaveProperty('files')
  })

  it('shows the turn’s plan (turn/plan/updated) as one task row, updated in place', () => {
    const n = createCodexNormalizer('/repo', () => 0)
    let s = fold(n.notification('turn/plan/updated', { threadId: 'th', turnId: 't1', explanation: null, plan: [{ step: 'Read', status: 'inProgress' }, { step: 'Edit', status: 'pending' }] }))
    s = fold(n.notification('turn/plan/updated', { threadId: 'th', turnId: 't1', explanation: null, plan: [{ step: 'Read', status: 'completed' }, { step: 'Edit', status: 'inProgress' }] }), s)
    expect(s.items).toEqual([
      {
        kind: 'tool',
        id: 'plan:t1',
        at: 0,
        name: 'Plan',
        arg: '2 项',
        state: 'ok',
        todos: [
          { text: 'Read', status: 'completed' },
          { text: 'Edit', status: 'in_progress' }
        ]
      }
    ])
    s = fold(n.notification('turn/plan/updated', { threadId: 'th', turnId: 't2', explanation: null, plan: [{ step: 'Test', status: 'pending' }] }), s)
    expect(s.items).toHaveLength(2)
  })

  it('shows the change a file approval is about: every file of its started fileChange item, and its reason', () => {
    const n = createCodexNormalizer('/repo', () => 0)
    const changes = [
      { path: '/repo/src/a.ts', kind: { type: 'update', move_path: null }, diff: '@@ -1,2 +1,2 @@\n a\n-b\n+c\n' },
      { path: '/repo/src/b.ts', kind: { type: 'add' }, diff: 'x\n' }
    ]
    let s = fold(n.notification('item/started', { item: { type: 'fileChange', id: 'f9', status: 'inProgress', changes } }))
    s = fold(n.request('3', 'item/fileChange/requestApproval', { threadId: 'th', turnId: 't', itemId: 'f9', reason: 'needs write access' }), s)
    const prompt = s.prompts[0]
    expect(prompt?.kind === 'permission' && prompt.diff).toMatchObject({ path: 'src/a.ts', added: 1, removed: 1 })
    expect(prompt?.kind === 'permission' && prompt.files?.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(prompt).toMatchObject({ detail: 'needs write access' })
    // One file, no reason: the file is the detail (the card shows it once, on the diff's header).
    const one = createCodexNormalizer('/repo', () => 0)
    let t = fold(one.notification('item/started', { item: { type: 'fileChange', id: 'f1', status: 'inProgress', changes: changes.slice(0, 1) } }))
    t = fold(one.request('5', 'item/fileChange/requestApproval', { itemId: 'f1', reason: null }), t)
    expect(t.prompts[0]).toMatchObject({ detail: 'src/a.ts', diff: { path: 'src/a.ts' } })
    expect(t.prompts[0]).not.toHaveProperty('files')
    // An item never seen: no diff.
    const other = fold(n.request('4', 'item/fileChange/requestApproval', { itemId: 'nope' }))
    expect(other.prompts[0]).not.toHaveProperty('diff')
  })

  it('forgets a file change once it is done or its approval is resolved', () => {
    const changes = [{ path: '/repo/src/a.ts', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-b\n+c\n' }]
    const started = { item: { type: 'fileChange', id: 'f9', status: 'inProgress', changes } }
    const n = createCodexNormalizer('/repo', () => 0)
    n.notification('item/started', started)
    n.notification('item/completed', { item: { ...started.item, status: 'completed' } })
    expect(fold(n.request('3', 'item/fileChange/requestApproval', { itemId: 'f9' })).prompts[0]).not.toHaveProperty('diff')
    const m = createCodexNormalizer('/repo', () => 0)
    m.notification('item/started', started)
    expect(fold(m.request('4', 'item/fileChange/requestApproval', { itemId: 'f9' })).prompts[0]).toHaveProperty('diff')
    m.notification('serverRequest/resolved', { requestId: 4 })
    expect(fold(m.request('5', 'item/fileChange/requestApproval', { itemId: 'f9' })).prompts[0]).not.toHaveProperty('diff')
    // A turn that ends (interrupted, failed) before the change completes takes it along.
    const k = createCodexNormalizer('/repo', () => 0)
    k.notification('item/started', started)
    k.notification('turn/completed', { turn: { id: 't', status: 'interrupted' } })
    expect(fold(k.request('6', 'item/fileChange/requestApproval', { itemId: 'f9' })).prompts[0]).not.toHaveProperty('diff')
  })

  it('keeps what an MCP or dynamic tool returned, and why it failed', () => {
    const n = createCodexNormalizer('/repo', () => 0)
    const s = fold([
      ...n.notification('item/completed', {
        item: { type: 'mcpToolCall', id: 'm1', server: 'figma', tool: 'get_screenshot', status: 'completed', result: { content: [{ type: 'text', text: 'node 1:2' }, { type: 'image', data: 'x' }], structuredContent: null }, error: null }
      }),
      ...n.notification('item/completed', { item: { type: 'mcpToolCall', id: 'm2', server: 'figma', tool: 'use_figma', status: 'failed', result: null, error: { message: 'not authorised' } } }),
      ...n.notification('item/completed', { item: { type: 'dynamicToolCall', id: 'd1', tool: 'lookup', status: 'completed', success: false, contentItems: [{ type: 'inputText', text: 'no such key' }] } })
    ])
    expect(s.items[0]).toMatchObject({ kind: 'tool', name: 'get_screenshot', state: 'ok', output: 'node 1:2' })
    expect(s.items[1]).toMatchObject({ kind: 'tool', name: 'use_figma', state: 'error', output: 'not authorised' })
    expect(s.items[2]).toMatchObject({ kind: 'tool', name: 'lookup', state: 'error', output: 'no such key' })
  })

  // Field names from the generated types (v2/ThreadItem.ts `collabAgentToolCall`, codex 0.166.0); not run against a
  // real Codex spawning an agent.
  it('shows a collab agent call as one 子 agent row: its prompt, status and duration', () => {
    const n = createCodexNormalizer('/repo', () => 0)
    const call = { type: 'collabAgentToolCall', id: 'c1', tool: 'spawnAgent', senderThreadId: 't0', receiverThreadIds: ['t1'], prompt: '查 SameSite\n在 Safari 的行为', model: null, reasoningEffort: null, agentsStates: {}, startedAtMs: 1000 }
    let s = fold(n.notification('item/started', { item: { ...call, status: 'inProgress' } }))
    expect(s.items).toEqual([{ kind: 'tool', id: 'c1', at: 1000, name: 'Subagent', arg: '查 SameSite 在 Safari 的行为', state: 'running' }])
    s = fold(n.notification('item/completed', { item: { ...call, status: 'completed', completedAtMs: 43_000 } }), s)
    expect(s.items[0]).toMatchObject({ state: 'ok', ms: 42_000 })
    const m = createCodexNormalizer('/repo', () => 0)
    const failed = fold([
      ...m.notification('item/completed', { item: { ...call, id: 'c2', status: 'failed' } }),
      ...m.notification('item/completed', { item: { ...call, id: 'c3', tool: 'wait', prompt: null, status: 'interrupted' } })
    ])
    expect(failed.items).toMatchObject([
      { name: 'Subagent', state: 'error' },
      { name: 'Subagent', arg: 'wait', state: 'error' }
    ])
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

  it('shows why a turn failed or never started, once', () => {
    const n = createCodexNormalizer('/repo', () => 0)
    let s = fold(n.notification('error', { error: { message: 'unexpected status 503' }, willRetry: false }))
    s = fold(n.notification('turn/completed', { turn: { id: 't', status: 'failed', error: { message: 'unexpected status 503' } } }), s)
    s = fold(n.notification('turn/completed', { turn: { id: 't2', status: 'failed', error: { message: 'stream disconnected' } } }), s)
    s = fold(n.failed('model not supported'), s)
    expect(s.items.map((i) => (i.kind === 'system' ? i.text : i.kind))).toEqual(['unexpected status 503', 'stream disconnected', 'model not supported'])
  })

  it('shows reasoning only with a summary to open', () => {
    const n = createCodexNormalizer('/repo', () => 0)
    const s = fold([
      ...n.notification('item/completed', { item: { type: 'reasoning', id: 'r1', summary: [], content: [], startedAtMs: 1000, completedAtMs: 3000 } }),
      ...n.notification('item/completed', { item: { type: 'reasoning', id: 'r2', summary: ['**Checking tests**'], content: [], startedAtMs: 4000, completedAtMs: 5500 } })
    ])
    expect(s.items).toEqual([{ kind: 'thinking', id: 'r2', at: 4000, text: '**Checking tests**', ms: 1500 }])
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

  it('offers visible models, the chosen one’s efforts and 权限, and applies them per turn (Figma 56)', () => {
    const config = codexConfig(models, {})
    expect(config.map((c) => [c.id, c.current])).toEqual([
      ['model', 'gpt-6.1-sol'],
      ['effort', 'high'],
      ['permission', 'accept-edits']
    ])
    expect(config[2]?.values.map((v) => v.label)).toEqual(['询问', '接受编辑', '自动'])
    expect(codexTurnParams('th', 'hi', config, ['/a.png'])).toEqual({
      threadId: 'th',
      input: [{ type: 'text', text: 'hi', text_elements: [] }, { type: 'localImage', path: '/a.png' }],
      model: 'gpt-6.1-sol',
      effort: 'high',
      serviceTier: null,
      approvalPolicy: 'on-request'
    })
    // 自动 is Codex's own reviewer; 询问 asks before anything it is not sure is safe.
    const at = (permission: 'ask' | 'auto') => codexTurnParams('th', 'hi', codexConfig(models, { permission }))
    expect(at('auto')).toMatchObject({ approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' })
    expect(at('ask')).toEqual(expect.objectContaining({ approvalPolicy: 'untrusted' }))
    expect(at('ask')).not.toHaveProperty('approvalsReviewer')
  })

  it('offers 快速 on a model with the priority service tier and sends it per turn (Figma 65)', () => {
    const tiered = [{ id: 'gpt-6.1-sol', isDefault: true, serviceTiers: [{ id: 'priority', name: 'Fast' }] }, { id: 'gpt-mini', serviceTiers: [] }]
    expect(codexConfig(tiered, {}).find((c) => c.id === 'fast')).toMatchObject({ current: 'off' })
    expect(codexConfig(tiered, { model: 'gpt-mini' }).find((c) => c.id === 'fast')).toBeUndefined()
    expect(codexTurnParams('th', 'hi', codexConfig(tiered, { fast: true }))).toMatchObject({ serviceTier: 'priority' })
    // Off goes as null: a tier set on an earlier turn would otherwise hold.
    expect(codexTurnParams('th', 'hi', codexConfig(tiered, {}))).toMatchObject({ serviceTier: null })
    // A model without the tier after 快速 was on: null, so the earlier tier does not hold.
    expect(codexTurnParams('th', 'hi', codexConfig(tiered, { model: 'gpt-mini', fast: true }))).toMatchObject({ serviceTier: null })
  })
})

describe('hunksOfUnifiedDiff', () => {
  it('reads hunk heads and body lines, skipping file headers and no-newline markers', () => {
    expect(hunksOfUnifiedDiff('--- a/x\n+++ b/x\n@@ -3 +3,2 @@\n-a\n+b\n+c\n\\ No newline at end of file\n')).toEqual([{ oldStart: 3, newStart: 3, lines: ['-a', '+b', '+c'] }])
  })
})
