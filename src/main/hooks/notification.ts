// What a Notification hook is about, from its type or (for agents that send none) its wording: shared by the Claude /
// Codex normaliser and the Gemini / Qwen / Pi one.

export function classifyNotification(type: string | undefined, message: string): 'permission' | 'question' | 'idle' | 'other' {
  switch (type) {
    case 'permission_prompt':
      return 'permission'
    case 'elicitation_dialog':
    case 'elicitation_url_dialog':
      return 'question'
    case 'idle_prompt':
      return 'idle'
    // A teammate (agent teams) asks the lead's TUI for permission (Claude 2.1.304).
    case 'worker_permission_prompt':
      return 'permission'
  }
  if (type === undefined || type === '') {
    if (/permission|approval|approve/i.test(message)) return 'permission'
    if (/question|elicitation/i.test(message)) return 'question'
    if (/waiting for your input|idle/i.test(message)) return 'idle'
  }
  return 'other'
}
