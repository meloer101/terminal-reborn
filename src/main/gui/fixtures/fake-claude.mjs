// A stand-in for `claude -p --input-format stream-json --output-format stream-json …` (PRD §6.17, the message shapes
// of scripts/spikes/53-gui-claude-stream-lab.mjs) for the GUI host's tests: no model, no tokens. A message containing
// "write" asks `can_use_tool` for a Write first; "die" exits with an error; "slow" streams until interrupted; "late echo"
// replays the message 1.5 s late; "think" thinks for 1.2 s first and sends it without text (display omitted). With
// CLAUDE_CONFIG_DIR set it writes its messages to a transcript there like the real CLI (`uuid` / `parentUuid`, a
// `--resume-session-at` resume hangs the next message under that message). `--version` answers as Claude Code 2.1.318.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const SESSION = 'fake-claude-session'
const args = process.argv.slice(2)
const argAfter = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
if (args[0] === '--version') {
  process.stdout.write('2.1.318 (Claude Code)\n')
  process.exit(0)
}
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
  if (!text.includes('think')) return reply(text)
  out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }, session_id: SESSION })
  setTimeout(() => {
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'EsYB' }] }, session_id: SESSION, parent_tool_use_id: null, thinking_duration_ms: 1200 })
    reply(text)
  }, 1200)
}

function reply(text) {
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
  if (text.includes('colors')) {
    // A command with colored output and a reply in rich Markdown (Figma 59J's tool rows and type scale).
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu2', name: 'Read', input: { file_path: 'src/auth/session.ts' } }] }, session_id: SESSION, parent_tool_use_id: null })
    out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu2', content: 'export const session = 1' }] }, session_id: SESSION, parent_tool_use_id: null })
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu3', name: 'Bash', input: { command: 'pnpm vitest run server/auth' } }] }, session_id: SESSION, parent_tool_use_id: null })
    const colored = '\x1b[32m✓\x1b[39m server/auth/login.test.ts \x1b[2m(8 tests)\x1b[22m\n\x1b[31m✗ server/auth/refresh.test.ts > rotates the token\x1b[39m\n\x1b[1mTests\x1b[22m  \x1b[91m1 failed\x1b[39m | \x1b[92m8 passed\x1b[39m'
    out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu3', content: colored, is_error: true }] }, session_id: SESSION, parent_tool_use_id: null })
    const markdown = '## 测试结果\n\n1 个失败：刷新接口还在读 `localStorage`。\n\n- 登录改成 Set-Cookie\n- 删掉 `session.ts` 里的 localStorage\n\n```ts\nres.cookie(\'session\', token, { httpOnly: true })\n```\n\n| 文件 | 结果 |\n| --- | --- |\n| login.test.ts | 通过 |\n| refresh.test.ts | 失败 |'
    return finish({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: markdown }] }, session_id: SESSION, parent_tool_use_id: null })
  }
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
