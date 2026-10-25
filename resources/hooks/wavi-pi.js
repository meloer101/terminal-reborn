// Wavi's extension for Pi (loaded per launch with `pi -e <this file>`, never installed into ~/.pi; ROADMAP 7 ②).
// Forwards Pi's agent events to Wavi's hook socket as Claude-shaped hook payloads (resources/hooks/tr-hook.sh does the
// same for Claude), so Wavi's status code reads Pi like the others. Pi has no approval dialogs, so nothing here waits
// on Wavi: every post is fire-and-forget with a short timeout, and an absent Wavi costs nothing.
// Event shapes: @earendil-works/pi-coding-agent core/extensions/types (0.84.1 and 1.x).
/* global process, Buffer */
import { request } from 'node:http'

const { TR_HOOK_SOCK: sock, TR_HOOK_TOKEN: token, TR_SESSION_ID: session } = process.env

function post(event, body, timeoutMs = 5000) {
  return new Promise((done) => {
    if (!sock || !token || !session) return done('')
    const data = JSON.stringify(body)
    const req = request(
      {
        socketPath: sock,
        method: 'POST',
        path: `/hook/${event}?session=${encodeURIComponent(session)}&agent=pi`,
        timeout: timeoutMs,
        headers: { 'X-TR-Token': token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      },
      (res) => {
        res.resume()
        res.on('end', () => done(''))
      }
    )
    req.on('error', () => done(''))
    req.on('timeout', () => {
      req.destroy()
      done('')
    })
    req.end(data)
  })
}

/** Pi's tools in Claude's terms, keeping only what Wavi's status line shows. */
function claudeTool(name, args) {
  const a = args && typeof args === 'object' ? args : {}
  const path = typeof a.path === 'string' ? a.path : typeof a.file_path === 'string' ? a.file_path : undefined
  switch (name) {
    case 'bash':
      return { tool_name: 'Bash', tool_input: typeof a.command === 'string' ? { command: a.command } : {} }
    case 'edit':
      return { tool_name: 'Edit', tool_input: path ? { file_path: path } : {} }
    case 'write':
      return { tool_name: 'Write', tool_input: path ? { file_path: path } : {} }
    case 'read':
      return { tool_name: 'Read', tool_input: path ? { file_path: path } : {} }
    case 'grep':
      return { tool_name: 'Grep', tool_input: typeof a.pattern === 'string' ? { pattern: a.pattern } : {} }
    case 'find':
      return { tool_name: 'Glob', tool_input: typeof a.pattern === 'string' ? { pattern: a.pattern } : {} }
    default:
      return { tool_name: String(name), tool_input: {} }
  }
}

function assistantText(message) {
  if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) return ''
  return message.content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
}

export default function wavi(pi) {
  if (!sock || !token || !session) return
  const calls = new Map()
  let lastText = ''
  let lastError

  pi.on('session_start', (event, ctx) => {
    let id
    try {
      id = ctx.sessionManager.getSessionId()
    } catch {
      id = undefined
    }
    void post('SessionStart', { session_id: id, source: event.reason })
  })
  pi.on('before_agent_start', (event) => {
    lastText = ''
    lastError = undefined
    void post('UserPromptSubmit', { prompt: typeof event.prompt === 'string' ? event.prompt : '' })
  })
  pi.on('tool_execution_start', (event) => {
    const tool = claudeTool(event.toolName, event.args)
    calls.set(event.toolCallId, tool)
    void post('PreToolUse', tool)
  })
  pi.on('tool_execution_end', (event) => {
    const tool = calls.get(event.toolCallId) ?? claudeTool(event.toolName, undefined)
    calls.delete(event.toolCallId)
    void post(event.isError ? 'PostToolUseFailure' : 'PostToolUse', tool)
  })
  pi.on('message_end', (event) => {
    const message = event.message
    if (!message || message.role !== 'assistant') return
    const text = assistantText(message)
    if (text) lastText = text
    lastError = message.stopReason === 'error' ? String(message.errorMessage ?? 'error') : undefined
  })
  pi.on('agent_settled', () => {
    if (lastError) void post('StopFailure', { error: lastError, last_assistant_message: lastText })
    else void post('Stop', { last_assistant_message: lastText })
  })
  pi.on('session_shutdown', async (event) => {
    await post('SessionEnd', { reason: event.reason }, 1000)
  })
}
