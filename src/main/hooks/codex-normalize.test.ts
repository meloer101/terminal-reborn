import { describe, expect, it } from 'vitest'
import { codexFixtures as fx } from './codex-fixtures'
import { mapCodexTool, normalizeHook, parsePatchFiles } from './normalize'

const codex = (event: string, payload: unknown) => normalizeHook('codex', event, payload)

describe('normalizeHook · codex lifecycle (real payloads)', () => {
  it('SessionStart', () => {
    expect(codex('SessionStart', fx.SessionStart)).toEqual({
      events: [{ type: 'session-start', agentSessionId: '00000000-0000-7000-8000-000000000000' }],
      clears: 'none'
    })
  })

  it('UserPromptSubmit carries the prompt and clears pending prompts', () => {
    expect(codex('UserPromptSubmit', fx.UserPromptSubmit)).toEqual({
      events: [{ type: 'prompt-submit', prompt: 'Reply with only the word OK.' }],
      clears: 'all',
      newTurn: true
    })
  })

  it('Stop', () => {
    expect(codex('Stop', fx.Stop)).toEqual({ events: [{ type: 'stop', message: 'DONE' }], clears: 'all' })
  })

  it('events Codex 0.142.5 sends but the UI has no use for yield nothing', () => {
    for (const event of ['PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'SessionEnd', 'Interrupt', 'Whatever']) {
      expect(codex(event, { hook_event_name: event })).toEqual({ events: [], clears: 'none' })
    }
  })

  it('bad payloads do not throw', () => {
    expect(codex('PreToolUse', undefined).events).toEqual([])
    expect(codex('PreToolUse', 'nope').events).toEqual([])
    expect(codex('PreToolUse', { hook_event_name: 'PreToolUse' }).events).toEqual([{ type: 'tool-start', tool: 'unknown', input: {} }])
  })
})

describe('normalizeHook · codex shell tool', () => {
  it('PreToolUse becomes a Bash tool-start', () => {
    const result = codex('PreToolUse', fx.PreToolUse_Bash)
    expect(result.events).toEqual([{ type: 'tool-start', tool: 'Bash', input: { command: 'echo codex-lab-ran > /work/project/ran.txt' } }])
    expect(result.questions).toBeUndefined()
    expect(result.clears).toBe('none')
  })

  it('PostToolUse is always ok (no success flag in the payload) and clears only its own tool call', () => {
    const result = codex('PostToolUse', fx.PostToolUse_Bash_failed)
    expect(result.events).toEqual([{ type: 'tool-end', tool: 'Bash', input: { command: 'ls /work/project/does-not-exist' }, ok: true }])
    expect(result.clears).toBe('tool')
  })

  it('PermissionRequest becomes a prompt draft without any allow-always suggestion', () => {
    const result = codex('PermissionRequest', fx.PermissionRequest_Bash)
    expect(result.events).toEqual([{ type: 'permission-request', tool: 'Bash', input: { command: 'echo codex-lab-ran > /work/project/ran.txt' } }])
    expect(result.permission).toEqual({
      tool: 'Bash',
      input: { command: 'echo codex-lab-ran > /work/project/ran.txt' },
      summary: '运行 echo codex-lab-ran > /work/project/ran.txt',
      suggestions: []
    })
  })

  it('the request and the tool-end of the same call map to the same tool + input (that is how a TUI answer withdraws the prompt)', () => {
    const request = codex('PermissionRequest', fx.PermissionRequest_Bash).permission
    const end = codex('PostToolUse', fx.PostToolUse_Bash).events[0]
    expect(end).toMatchObject({ type: 'tool-end', tool: request?.tool, input: request?.input })
  })

  it('a description Codex adds to the approval request does not break that match', () => {
    const request = codex('PermissionRequest', {
      ...fx.PermissionRequest_Bash,
      tool_input: { command: 'echo codex-lab-ran > /work/project/ran.txt', description: 'Allow writing the marker?' }
    }).permission
    expect(request?.input).toEqual({ command: 'echo codex-lab-ran > /work/project/ran.txt' })
  })
})

describe('normalizeHook · codex apply_patch', () => {
  it('maps a new-file patch to Write with the file path, not the patch text', () => {
    expect(codex('PreToolUse', fx.PreToolUse_apply_patch).events).toEqual([
      { type: 'tool-start', tool: 'Write', input: { file_path: 'patched.txt', files: ['patched.txt'] } }
    ])
  })

  it('PermissionRequest summarises the file', () => {
    expect(codex('PermissionRequest', fx.PermissionRequest_apply_patch).permission?.summary).toBe('写入 patched.txt')
  })

  it('request and tool-end agree', () => {
    const request = codex('PermissionRequest', fx.PermissionRequest_apply_patch).permission
    const end = codex('PostToolUse', fx.PostToolUse_apply_patch).events[0]
    expect(end).toMatchObject({ tool: request?.tool, input: request?.input })
  })

  it('parses Add / Update / Delete headers; any non-Add makes it an Edit', () => {
    const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** Delete File: old.txt\n*** Add File: b.txt\n+z\n*** End Patch'
    expect(parsePatchFiles(patch)).toEqual({ files: ['src/a.ts', 'old.txt', 'b.txt'], allNew: false })
    expect(mapCodexTool('apply_patch', { command: patch })).toEqual({ tool: 'Edit', input: { file_path: 'src/a.ts', files: ['src/a.ts', 'old.txt', 'b.txt'] } })
  })

  it('an unparseable patch keeps an empty input rather than throwing', () => {
    expect(mapCodexTool('apply_patch', { command: 'garbage' })).toEqual({ tool: 'Edit', input: {} })
    expect(mapCodexTool('apply_patch', 'garbage')).toEqual({ tool: 'Edit', input: {} })
  })
})

describe('normalizeHook · codex request_user_input', () => {
  it('is an AskUserQuestion with parsed questions (single-select only)', () => {
    const result = codex('PreToolUse', fx.PreToolUse_request_user_input)
    expect(result.events[0]).toMatchObject({ type: 'tool-start', tool: 'AskUserQuestion' })
    expect(result.questions).toEqual([
      { header: 'One', question: 'First question?', multiSelect: false, options: [{ label: 'A', description: 'Option A' }, { label: 'B', description: 'Option B' }] },
      {
        header: 'Two',
        question: 'Second question?',
        multiSelect: false,
        options: [{ label: 'C', description: 'Option C' }, { label: 'D', description: 'Option D' }, { label: 'E', description: 'Option E' }]
      }
    ])
  })

  it('its PostToolUse is an AskUserQuestion tool-end, which withdraws the question', () => {
    const result = codex('PostToolUse', fx.PostToolUse_request_user_input)
    expect(result.events[0]).toMatchObject({ type: 'tool-end', tool: 'AskUserQuestion', ok: true })
    expect(result.clears).toBe('tool')
  })
})

describe('mapCodexTool', () => {
  it('passes other tools (MCP, update_plan) through with their input', () => {
    expect(mapCodexTool('mcp__fs__read', { path: '/x' })).toEqual({ tool: 'mcp__fs__read', input: { path: '/x' } })
    expect(mapCodexTool('update_plan', { plan: [] })).toEqual({ tool: 'update_plan', input: { plan: [] } })
  })

  it('wraps a bare string input as a command and drops non-object inputs', () => {
    expect(mapCodexTool('Bash', 'ls')).toEqual({ tool: 'Bash', input: { command: 'ls' } })
    expect(mapCodexTool('whatever', 42)).toEqual({ tool: 'whatever', input: {} })
  })
})

describe('normalizeHook · codex Bash results for the turn checks (PRD F9 / F4, §6.7)', () => {
  it('has the output but no exit code', () => {
    expect(codex('PostToolUse', fx.PostToolUse_Bash_failed).bashCall).toEqual({
      command: 'ls /work/project/does-not-exist',
      dir: '/work/project',
      result: { exitCode: null, output: 'ls: /work/project/does-not-exist: No such file or directory\n' }
    })
  })

  it('uses an exit code when a version gives one, and reads an argv command', () => {
    const call = codex('PostToolUse', { ...fx.PostToolUse_Bash, tool_input: { command: ['bash', '-lc', 'npm test'] }, tool_response: 'Exit code: 1\nWall time: 2 seconds\nOutput:\n' })
    expect(call.bashCall?.command).toBe('npm test')
    expect(call.bashCall?.result.exitCode).toBe(1)
    expect(codex('PostToolUse', { ...fx.PostToolUse_Bash, tool_response: { output: 'ok', exit_code: 0 } }).bashCall?.result).toEqual({ exitCode: 0, output: 'ok' })
    // The status code keeps seeing the same `{ command }` as before.
    expect(call.events).toEqual([{ type: 'tool-end', tool: 'Bash', input: {}, ok: true }])
  })
})
