// Real Codex CLI 0.142.5 hook payloads captured with scripts/spikes/41-codex-hooks-lab.mjs (docs/spikes/codex.md),
// scrubbed of personal paths and ids (`transcript_path` is dropped, ids are fixed, the lab directory is /work/project).
// The CLI, its TUI, sandbox/approval logic and hook delivery were real; the model behind it was the scripted local
// stand-in scripts/spikes/codex-mock-provider.mjs because the user's provider answered 503 for every model.
const common = {
  session_id: '00000000-0000-7000-8000-000000000000',
  cwd: '/work/project',
  model: 'gpt-5.5',
  permission_mode: 'default'
}
const turn = { turn_id: '00000000-0000-7000-8000-0000000000aa' }

const patch = '*** Begin Patch\n*** Add File: patched.txt\n+hello from the lab\n*** End Patch'
const questions = [
  {
    id: 'q1',
    header: 'One',
    question: 'First question?',
    options: [
      { label: 'A', description: 'Option A' },
      { label: 'B', description: 'Option B' }
    ]
  },
  {
    id: 'q2',
    header: 'Two',
    question: 'Second question?',
    options: [
      { label: 'C', description: 'Option C' },
      { label: 'D', description: 'Option D' },
      { label: 'E', description: 'Option E' }
    ]
  }
]

export const codexFixtures = {
  SessionStart: { ...common, hook_event_name: 'SessionStart', source: 'startup' },
  UserPromptSubmit: { ...common, ...turn, hook_event_name: 'UserPromptSubmit', prompt: 'Reply with only the word OK.' },
  PreToolUse_Bash: {
    ...common,
    ...turn,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo codex-lab-ran > /work/project/ran.txt' },
    tool_use_id: 'call_1'
  },
  // No tool_use_id, no permission_suggestions.
  PermissionRequest_Bash: {
    ...common,
    ...turn,
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'echo codex-lab-ran > /work/project/ran.txt' }
  },
  // tool_response is the tool's text output: there is no exit code / success flag for Bash.
  PostToolUse_Bash: {
    ...common,
    ...turn,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo codex-lab-ran > /work/project/ran.txt' },
    tool_response: '',
    tool_use_id: 'call_1'
  },
  PostToolUse_Bash_failed: {
    ...common,
    ...turn,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'ls /work/project/does-not-exist' },
    tool_response: 'ls: /work/project/does-not-exist: No such file or directory\n',
    tool_use_id: 'call_1'
  },
  PreToolUse_apply_patch: {
    ...common,
    ...turn,
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { command: patch },
    tool_use_id: 'call_1'
  },
  PermissionRequest_apply_patch: {
    ...common,
    ...turn,
    hook_event_name: 'PermissionRequest',
    tool_name: 'apply_patch',
    tool_input: { command: patch }
  },
  PostToolUse_apply_patch: {
    ...common,
    ...turn,
    hook_event_name: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: { command: patch },
    tool_response: 'Exit code: 0\nWall time: 0.1 seconds\nOutput:\nSuccess. Updated the following files:\nA patched.txt\n',
    tool_use_id: 'call_1'
  },
  // Plan mode only ("request_user_input is unavailable in Default mode").
  PreToolUse_request_user_input: {
    ...common,
    ...turn,
    hook_event_name: 'PreToolUse',
    tool_name: 'request_user_input',
    tool_input: { questions },
    tool_use_id: 'call_1'
  },
  PostToolUse_request_user_input: {
    ...common,
    ...turn,
    hook_event_name: 'PostToolUse',
    tool_name: 'request_user_input',
    tool_input: { questions },
    tool_response: '{"answers":{"q1":{"answers":["A"]},"q2":{"answers":["E"]}}}',
    tool_use_id: 'call_1'
  },
  Stop: { ...common, ...turn, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'DONE' }
} as const
