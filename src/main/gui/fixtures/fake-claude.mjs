// A stand-in for `claude -p --input-format stream-json --output-format stream-json …` (PRD §6.17, the message shapes
// of scripts/spikes/53-gui-claude-stream-lab.mjs) for the GUI host's tests: no model, no tokens. A message containing
// "write" asks `can_use_tool` for a Write first; "die" exits with an error; "slow" streams until interrupted; "late echo"
// replays the message 1.5 s late. With CLAUDE_CONFIG_DIR set it writes its messages to a transcript there like the real
// CLI (`uuid` / `parentUuid`, a `--resume-session-at` resume hangs the next message under that message).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const SESSION = 'fake-claude-session'
const args = process.argv.slice(2)
const argAfter = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
const transcript = process.env.CLAUDE_CONFIG_DIR
  ? join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'), `${SESSION}.jsonl`)
  : null
const lastUuid = () => {
  if (!transcript || !existsSync(transcript)) return null
  const lines = readFileSync(transcript, 'utf8').trim().split('\n')
  return lines.length > 0 && lines[0] ? JSON.parse(lines[lines.length - 1]).uuid : null
}
let parent = argAfter('--resume-session-at') ?? (args.includes('--resume') ? lastUuid() : null)
let assistants = 0
const out = (m) => {
  if (m.type === 'assistant' && !m.uuid) m = { ...m, uuid: `assistant-${process.pid}-${++assistants}` }
  if (transcript && (m.type === 'assistant' || m.type === 'user') && m.uuid) {
    mkdirSync(dirname(transcript), { recursive: true })
    appendFileSync(transcript, `${JSON.stringify({ type: m.type, uuid: m.uuid, parentUuid: parent, sessionId: SESSION, message: m.message })}\n`)
    parent = m.uuid
  }
  process.stdout.write(`${JSON.stringify(m)}\n`)
}
const log = process.env.FAKE_ARGS_FILE
if (log) writeFileSync(log, JSON.stringify({ args, entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ?? null }))

// Not JSON: what a login shell's rc files may print.
process.stdout.write('welcome to zsh\n')

let model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'opus'
let turn = null
let slow = null
const queue = []

function startTurn(text) {
  turn = { text, waiting: null }
  out({ type: 'system', subtype: 'init', session_id: SESSION, model, permissionMode: 'default' })
  out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, session_id: SESSION })
  out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }, session_id: SESSION })
  out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }, session_id: SESSION })
  if (text.includes('die')) {
    process.stderr.write('Error: fake crash\n')
    process.exit(2)
  }
  if (text.includes('slow')) {
    slow = setInterval(() => out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '.' } }, session_id: SESSION }), 50)
    return
  }
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `Hello: ${text}` }] }, session_id: SESSION, parent_tool_use_id: null })
  if (text.includes('write')) {
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: 'a.txt', content: 'hi' } }] }, session_id: SESSION, parent_tool_use_id: null })
    out({ type: 'control_request', request_id: 'req-1', request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: 'a.txt', content: 'hi' }, permission_suggestions: [{ type: 'addRules' }], tool_use_id: 'tu1' } })
    turn.waiting = 'req-1'
    return
  }
  finish()
}

function finish(extra) {
  if (extra) out(extra)
  out({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: SESSION })
  turn = null
  const next = queue.shift()
  if (next) startTurn(next)
}

let replayed = 0

function onUser(message) {
  const content = message.message.content
  const text = typeof content === 'string' ? content : content.filter((b) => b.type === 'text').map((b) => b.text).join('') + ` [${content.filter((b) => b.type === 'image').length} image]`
  const take = () => {
    // --replay-user-messages: the message comes back as the conversation's, with its uuid (as the real CLI does).
    out({ ...message, uuid: message.uuid ?? `user-${process.pid}-${++replayed}`, session_id: SESSION })
    if (turn) queue.push(text)
    else startTurn(text)
  }
  // "late echo": the real CLI replays a message only once it takes it (hooks, its queue), often a second or more.
  if (text.includes('late echo')) setTimeout(take, 1500)
  else take()
}

function control(message) {
  const r = message.request
  const reply = (response) => out({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response } })
  if (r.subtype === 'initialize') {
    reply({
      commands: [{ name: 'review', description: 'Review the diff (project)', argumentHint: '[path]' }],
      models: [
        { value: 'opus', displayName: 'Opus', supportsEffort: true, supportedEffortLevels: ['low', 'high', 'max'] },
        { value: 'haiku', displayName: 'Haiku' }
      ],
      current_permission_mode: 'default'
    })
  } else if (r.subtype === 'get_settings') reply({ effective: { effortLevel: 'max' }, sources: [], applied: {} })
  else if (r.subtype === 'set_model') {
    model = r.model
    reply({})
  } else if (r.subtype === 'set_permission_mode' || r.subtype === 'apply_flag_settings') reply({})
  else if (r.subtype === 'interrupt') {
    reply({})
    if (slow) {
      clearInterval(slow)
      slow = null
      out({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: SESSION })
      turn = null
    }
  } else out({ type: 'control_response', response: { subtype: 'error', request_id: message.request_id, error: 'unknown' } })
}

function controlResponse(message) {
  const r = message.response
  if (!turn || r.request_id !== turn.waiting) return
  turn.waiting = null
  const allowed = r.response.behavior === 'allow'
  out({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: allowed ? 'File created' : r.response.message, is_error: !allowed }] },
    session_id: SESSION,
    parent_tool_use_id: null,
    tool_use_result: allowed ? { type: 'create', filePath: 'a.txt', content: 'hi' } : undefined
  })
  finish({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: allowed ? 'Wrote it' : 'Refused' }] }, session_id: SESSION, parent_tool_use_id: null })
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (!line.trim()) continue
    const m = JSON.parse(line)
    if (m.type === 'control_request') control(m)
    else if (m.type === 'control_response') controlResponse(m)
    else if (m.type === 'user') onUser(m)
  }
})
process.stdin.on('end', () => process.exit(0))
