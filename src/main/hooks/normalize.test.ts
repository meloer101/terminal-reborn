import { describe, expect, it } from 'vitest'
import { claudeFixtures as fx } from './fixtures'
import { classifyNotification, normalizeHook, parseQuestions, summarizeToolUse } from './normalize'

const claude = (event: string, payload: unknown) => normalizeHook('claude', event, payload)

describe('normalizeHook · lifecycle events (real payloads)', () => {
  it('SessionStart', () => {
    expect(claude('SessionStart', fx.SessionStart)).toEqual({
      events: [{ type: 'session-start', agentSessionId: '00000000-0000-4000-8000-000000000000' }],
      clears: 'none'
    })
  })

  it('SessionStart without a usable session_id still starts the session', () => {
    const start = { events: [{ type: 'session-start' }], clears: 'none' }
    expect(claude('SessionStart', { ...fx.SessionStart, session_id: undefined })).toEqual(start)
    expect(claude('SessionStart', { ...fx.SessionStart, session_id: 42 })).toEqual(start)
    expect(claude('SessionStart', { ...fx.SessionStart, session_id: '--resume; rm -rf ~' })).toEqual(start)
  })

  it('a SessionStart after /clear carries the new conversation id', () => {
    expect(claude('SessionStart', { ...fx.SessionStart, source: 'clear', session_id: 'new-id-1' }).events).toEqual([
      { type: 'session-start', agentSessionId: 'new-id-1' }
    ])
  })

  it('UserPromptSubmit carries the prompt and clears pending prompts', () => {
    expect(claude('UserPromptSubmit', fx.UserPromptSubmit)).toEqual({
      events: [{ type: 'prompt-submit', prompt: 'Reply with only the word OK.' }],
      clears: 'all'
    })
  })

  it('Stop carries the last reply', () => {
    expect(claude('Stop', fx.Stop)).toEqual({ events: [{ type: 'stop', message: 'OK' }], clears: 'all' })
  })

  it('Stop without a reply, and only the tail of a long one', () => {
    expect(claude('Stop', { hook_event_name: 'Stop' })).toEqual({ events: [{ type: 'stop' }], clears: 'all' })
    const long = `${'a'.repeat(5_000)}END`
    const [event] = claude('Stop', { hook_event_name: 'Stop', last_assistant_message: long }).events
    expect(event).toEqual({ type: 'stop', message: long.slice(-2_000) })
  })

  it('SessionEnd keeps the reason', () => {
    expect(claude('SessionEnd', fx.SessionEnd)).toEqual({
      events: [{ type: 'session-end', reason: 'prompt_input_exit' }],
      clears: 'all'
    })
  })

  it('StopFailure keeps the error text and its kind (2.1.304 plan-limit capture, PRD §6.6)', () => {
    expect(claude('StopFailure', fx.StopFailure_rate_limit)).toEqual({
      events: [{ type: 'stop-failure', message: "You've hit your session limit · resets 5:22pm (America/Bogota)", reason: 'rate_limit' }],
      clears: 'all'
    })
    const endpoint = { hook_event_name: 'StopFailure', error: 'rate_limit', last_assistant_message: 'API Error: Request rejected (429) · Rate limit exceeded' }
    expect(claude('StopFailure', endpoint).events).toEqual([
      { type: 'stop-failure', message: 'API Error: Request rejected (429) · Rate limit exceeded', reason: 'rate_limit' }
    ])
    expect(claude('StopFailure', { error: 'unknown' }).events).toEqual([{ type: 'stop-failure', message: 'unknown', reason: 'unknown' }])
    expect(claude('StopFailure', {}).events).toEqual([{ type: 'stop-failure' }])
  })
})

describe('normalizeHook · tools', () => {
  it('PreToolUse becomes tool-start with the raw input', () => {
    const result = claude('PreToolUse', fx.PreToolUse_Bash)
    expect(result.events).toEqual([{ type: 'tool-start', tool: 'Bash', input: fx.PreToolUse_Bash.tool_input }])
    expect(result.questions).toBeUndefined()
    expect(result.clears).toBe('none')
  })

  it('PostToolUse is a successful tool-end that clears only its own tool call', () => {
    const result = claude('PostToolUse', fx.PostToolUse_Bash)
    expect(result.events).toEqual([{ type: 'tool-end', tool: 'Bash', input: fx.PostToolUse_Bash.tool_input, ok: true }])
    expect(result.clears).toBe('tool')
  })

  it('PostToolUseFailure is a failed tool-end', () => {
    const result = claude('PostToolUseFailure', fx.PostToolUseFailure_Bash)
    expect(result.events).toEqual([{ type: 'tool-end', tool: 'Bash', input: fx.PostToolUseFailure_Bash.tool_input, ok: false }])
    expect(result.clears).toBe('tool')
  })

  it('AskUserQuestion PreToolUse also yields the parsed questions', () => {
    const result = claude('PreToolUse', fx.PreToolUse_AskUserQuestion)
    expect(result.events).toEqual([{ type: 'tool-start', tool: 'AskUserQuestion', input: fx.PreToolUse_AskUserQuestion.tool_input }])
    expect(result.questions).toEqual([
      {
        header: 'Pick',
        question: 'Which option do you prefer?',
        multiSelect: false,
        options: [
          { label: 'A', description: 'Option A' },
          { label: 'B', description: 'Option B' }
        ]
      }
    ])
  })

  it('AskUserQuestion PostToolUse (answers included) is a tool-end', () => {
    const result = claude('PostToolUse', fx.PostToolUse_AskUserQuestion)
    expect(result.events[0]).toMatchObject({ type: 'tool-end', tool: 'AskUserQuestion', ok: true })
  })
})

describe('normalizeHook · PermissionRequest', () => {
  it('a Bash request becomes a draft with a Chinese summary and the offered suggestions', () => {
    const result = claude('PermissionRequest', fx.PermissionRequest_Bash)
    // The event is what turns the session to needs_you; it names the call so two dialogs at once stay two asks.
    expect(result.events).toEqual([{ type: 'permission-request', tool: 'Bash', input: fx.PermissionRequest_Bash.tool_input }])
    expect(result.permission).toEqual({
      tool: 'Bash',
      input: fx.PermissionRequest_Bash.tool_input,
      summary: '运行 echo hooks-lab-ran > /work/project/ran.txt',
      suggestions: [{ type: 'addDirectories', directories: ['/work/project'], destination: 'session' }]
    })
  })

  it('no suggestions -> an empty list (canAllowAlways false downstream)', () => {
    const { permission } = claude('PermissionRequest', { tool_name: 'Write', tool_input: { file_path: '/a/b/c.ts' } })
    expect(permission?.suggestions).toEqual([])
    expect(permission?.summary).toBe('写入 b/c.ts')
  })

  it('allow-always never carries setMode or userSettings suggestions (real payload had setMode acceptEdits)', () => {
    const { permission } = claude('PermissionRequest', {
      tool_name: 'Bash',
      tool_input: { command: 'mkdir -p x' },
      permission_suggestions: [
        { type: 'addDirectories', directories: ['/work/project'], destination: 'session' },
        { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
        { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'x' }], behavior: 'allow', destination: 'userSettings' },
        { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'y' }], behavior: 'allow', destination: 'localSettings' }
      ]
    })
    expect(permission?.suggestions).toEqual([
      { type: 'addDirectories', directories: ['/work/project'], destination: 'session' },
      { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'y' }], behavior: 'allow', destination: 'localSettings' }
    ])
  })

  it('AskUserQuestion is left to the TUI: no permission draft, no event (its PreToolUse already waits)', () => {
    const result = claude('PermissionRequest', fx.PermissionRequest_AskUserQuestion)
    expect(result.permission).toBeUndefined()
    expect(result.events).toEqual([])
  })

  it('ExitPlanMode is left to the TUI too, but the plan approval still waits on the user', () => {
    const result = claude('PermissionRequest', { tool_name: 'ExitPlanMode', tool_input: { plan: 'x' } })
    expect(result.permission).toBeUndefined()
    expect(result.events).toEqual([{ type: 'permission-request', tool: 'ExitPlanMode', input: { plan: 'x' } }])
  })
})

// Claude 2.1.304 adds `agent_id` to every hook fired inside a subagent (a Task-tool worker, an in-process teammate).
describe('normalizeHook · subagents', () => {
  const sub = { agent_id: 'a1b2c3', agent_type: 'general-purpose' }

  it('tool calls and permission requests carry the subagent; main-thread ones do not', () => {
    expect(claude('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 't1', ...sub }).events).toEqual([
      { type: 'tool-start', tool: 'Bash', input: { command: 'ls' }, agentId: 'a1b2c3' }
    ])
    expect(claude('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {}, ...sub }).events[0]).toMatchObject({ agentId: 'a1b2c3' })
    expect(claude('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'ls' }, error: 'x', ...sub }).events[0]).toMatchObject({ ok: false, agentId: 'a1b2c3' })
    expect(claude('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' }, ...sub }).events).toEqual([
      { type: 'permission-request', tool: 'Bash', input: { command: 'ls' }, agentId: 'a1b2c3' }
    ])
    expect(claude('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }).events[0]).not.toHaveProperty('agentId')
  })

  it('SubagentStop ends that subagent; without an agent_id it means nothing', () => {
    expect(claude('SubagentStop', { stop_hook_active: false, agent_transcript_path: '/x.jsonl', ...sub }).events).toEqual([{ type: 'subagent-stop', agentId: 'a1b2c3' }])
    expect(claude('SubagentStop', { stop_hook_active: false }).events).toEqual([])
  })

  it('an odd agent_id is dropped, not carried along', () => {
    expect(claude('PreToolUse', { tool_name: 'Read', tool_input: {}, agent_id: 'x'.repeat(200) }).events[0]).not.toHaveProperty('agentId')
    expect(claude('PreToolUse', { tool_name: 'Read', tool_input: {}, agent_id: 42 }).events[0]).not.toHaveProperty('agentId')
  })
})

describe('normalizeHook · Notification', () => {
  it('classifies by notification_type', () => {
    expect(claude('Notification', fx.Notification_permission).events).toEqual([
      { type: 'notification', kind: 'permission', message: 'Claude needs your permission' }
    ])
    expect(claude('Notification', fx.Notification_idle).events).toEqual([
      { type: 'notification', kind: 'idle', message: 'Claude is waiting for your input' }
    ])
  })

  it('falls back to the message when the type is missing', () => {
    expect(classifyNotification(undefined, 'Claude needs your approval to run this')).toBe('permission')
    expect(classifyNotification(undefined, 'Claude has a question for you')).toBe('question')
    expect(classifyNotification(undefined, 'Claude is waiting for your input')).toBe('idle')
    expect(classifyNotification(undefined, 'Build finished')).toBe('other')
  })

  it('a teammate asking the lead for permission is a permission prompt (agent teams)', () => {
    expect(classifyNotification('worker_permission_prompt', 'reviewer needs permission for Bash')).toBe('permission')
  })

  it('maps elicitation dialogs to question and unknown types to other', () => {
    expect(classifyNotification('elicitation_dialog', '')).toBe('question')
    expect(classifyNotification('auth_success', 'Signed in, permission granted')).toBe('other')
  })
})

describe('normalizeHook · robustness', () => {
  it('unknown events and bad payloads yield nothing', () => {
    expect(claude('SubagentStart', { agent_id: 'x' })).toEqual({ events: [], clears: 'none' })
    expect(claude('PreToolUse', undefined).events).toEqual([])
    expect(claude('PreToolUse', 'nope').events).toEqual([])
    expect(claude('PreToolUse', []).events).toEqual([])
  })

  it('missing tool fields do not throw', () => {
    expect(claude('PreToolUse', { hook_event_name: 'PreToolUse' }).events).toEqual([{ type: 'tool-start', tool: 'unknown', input: {} }])
  })

  it('the agent decides which vocabulary applies (Codex is covered in codex-normalize.test.ts)', () => {
    expect(normalizeHook('codex', 'SessionEnd', { reason: 'other' }).events).toEqual([])
    expect(normalizeHook('claude', 'SessionEnd', { reason: 'other' }).events).toEqual([{ type: 'session-end', reason: 'other' }])
  })
})

describe('parseQuestions', () => {
  it('handles multiSelect, missing descriptions and drops malformed entries', () => {
    expect(
      parseQuestions({
        questions: [
          { question: 'Pick some', multiSelect: true, options: [{ label: 'x' }, { nope: 1 }, { label: 'y', description: 'why' }] },
          { header: 'no question' },
          'junk'
        ]
      })
    ).toEqual([{ question: 'Pick some', multiSelect: true, options: [{ label: 'x' }, { label: 'y', description: 'why' }] }])
    expect(parseQuestions({})).toEqual([])
  })
})

describe('summarizeToolUse', () => {
  it.each([
    ['Bash', { command: 'pnpm test src/auth\nsecond line' }, '运行 pnpm test src/auth'],
    ['Bash', {}, '运行命令'],
    ['Edit', { file_path: '/repo/src/auth/session.ts' }, '编辑 auth/session.ts'],
    ['MultiEdit', { file_path: 'a.ts' }, '编辑 a.ts'],
    ['Write', { file_path: '/repo/README.md' }, '写入 repo/README.md'],
    ['Read', { file_path: '/repo/x.ts' }, '读取 repo/x.ts'],
    ['WebFetch', { url: 'https://example.com/a' }, '抓取 https://example.com/a'],
    ['WebSearch', { query: 'electron hooks' }, '搜索 electron hooks'],
    ['Grep', { pattern: 'useSession' }, '搜索 useSession'],
    ['mcp__pencil__batch_design', {}, '调用 pencil · batch_design'],
    ['SomethingNew', {}, '使用 SomethingNew']
  ])('%s %j -> %s', (tool, input, expected) => {
    expect(summarizeToolUse(tool, input)).toBe(expected)
  })

  it('truncates very long commands to one line', () => {
    const summary = summarizeToolUse('Bash', { command: 'x'.repeat(500) })
    expect(summary.length).toBeLessThanOrEqual(163)
    expect(summary.endsWith('…')).toBe(true)
  })
})

describe('normalizeHook · metrics (PRD F11 / F12)', () => {
  it('reads the statusLine relay into a context event and plan usage', () => {
    const result = normalizeHook(
      'claude',
      'StatusLine',
      { context_window: { used_percentage: 62, context_window_size: 200000 }, rate_limits: { seven_day: { used_percentage: 84 } } },
      5
    )
    expect(result.events).toEqual([{ type: 'context', context: { percent: 62, usedTokens: 124000, windowTokens: 200000, compactAt: 167000, compactPercent: 84 } }])
    expect(result.usage).toEqual({ vendor: 'claude', at: 5, windows: [{ minutes: 10080, percent: 84 }] })
    expect(result.clears).toBe('none')
  })

  it('hands todo-tool results to the bridge and flags /clear', () => {
    const post = normalizeHook('claude', 'PostToolUse', { tool_name: 'TodoWrite', tool_input: { todos: [] }, tool_response: { newTodos: [] } })
    expect(post.todoCall).toEqual({ tool: 'TodoWrite', input: { todos: [] }, response: { newTodos: [] } })
    expect(normalizeHook('claude', 'PostToolUse', { tool_name: 'Bash', tool_input: {} }).todoCall).toBeUndefined()
    expect(normalizeHook('claude', 'SessionStart', { session_id: 'abc', source: 'clear' }).cleared).toBe(true)
    expect(normalizeHook('claude', 'SessionStart', { session_id: 'abc', source: 'resume' }).cleared).toBeUndefined()
  })
})
