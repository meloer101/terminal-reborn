// A stand-in for `pi --mode rpc` (PRD F23 v1.160; shapes as Pi 0.84.1 sends them, measured 2026-11-08) for the GUI
// host's tests and the e2e: no model, no tokens. It plays Wavi's permission extension too: a tool call that is not
// read-only sends a `confirm` whose message is the extension's JSON and waits for the answer. Each prompt echoes the
// user's message and streams `Hello: <text> (<model>, <thinking>)`; "bash" runs `ls`, "edit" edits a.txt, "read"
// reads it (never asked); "slow" streams until `abort`; "refuse" fails the prompt's preflight. Launch arguments come as
// FAKE_PI_MODEL / FAKE_PI_THINKING / FAKE_PI_SESSION (the tests' prepare) or as `--model` / `--thinking` /
// `--session-id` (the e2e runs it with guiArgv's arguments). With FAKE_PI_LOG set, each launch's arguments and each
// command's type are appended to that file, one JSON line each.
import { appendFileSync } from 'node:fs'

const log = (entry) => process.env.FAKE_PI_LOG && appendFileSync(process.env.FAKE_PI_LOG, `${JSON.stringify(entry)}\n`)
log({ args: process.argv.slice(2) })
const arg = (flag) => {
  const at = process.argv.indexOf(flag)
  return at > 0 ? process.argv[at + 1] : undefined
}
const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`)
const flash = { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek', reasoning: true, input: ['text'], thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', max: 'max' } }
const pro = { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek', reasoning: true, input: ['text', 'image'], thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', max: 'max' } }
const models = [flash, pro]
const wanted = process.env.FAKE_PI_MODEL || arg('--model') || 'deepseek/deepseek-v4-flash'
const model = models.find((m) => `${m.provider}/${m.id}` === wanted) ?? flash
const thinking = process.env.FAKE_PI_THINKING || arg('--thinking') || 'high'
const sessionId = process.env.FAKE_PI_SESSION || arg('--session-id') || 'fake-pi-session'
let turn = null
let n = 0
const dialogs = new Map()

const respond = (id, command, data) => out({ id, type: 'response', command, success: true, ...(data !== undefined ? { data } : {}) })
const assistant = (content, stopReason = 'stop') => ({ role: 'assistant', content, provider: model.provider, model: model.id, stopReason })

function stream(text) {
  out({ type: 'message_start', message: assistant([], 'pending') })
  out({ type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: 0 } })
  for (const piece of text.match(/.{1,6}/g) ?? []) out({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: piece } })
}

function end(stopReason = 'stop', text) {
  if (text !== undefined) out({ type: 'message_update', assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: text } })
  out({ type: 'message_end', message: assistant(text !== undefined ? [{ type: 'text', text }] : [], stopReason) })
  out({ type: 'agent_end', messages: [] })
  out({ type: 'agent_settled' })
  turn = null
}

function tool(name, args, result, then) {
  const toolCallId = `call${++n}`
  out({ type: 'tool_execution_start', toolCallId, toolName: name, args })
  const finish = (ok) => {
    out({ type: 'tool_execution_end', toolCallId, toolName: name, result: ok ? result : { content: [{ type: 'text', text: `${name} was declined in Wavi.` }] }, isError: !ok })
    then()
  }
  if (name === 'read') return finish(true)
  const id = `ui-${n}`
  dialogs.set(id, (answer) => finish(answer.confirmed === true))
  out({ type: 'extension_ui_request', id, method: 'confirm', title: `Allow ${name}?`, message: JSON.stringify({ wavi: 1, tool: name, input: args }) })
}

function prompt(id, message) {
  if (message.includes('refuse')) return out({ id, type: 'response', command: 'prompt', success: false, error: 'No API key for deepseek' })
  respond(id, 'prompt')
  turn = { message }
  out({ type: 'agent_start' })
  out({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: message }], timestamp: Date.now() } })
  const reply = `Hello: ${message} (${model.id}, ${thinking})`
  const answer = () => {
    stream(reply)
    if (!message.includes('slow')) end('stop', reply)
  }
  if (message.includes('bash')) tool('bash', { command: 'ls' }, { content: [{ type: 'text', text: 'a.txt\n' }] }, answer)
  else if (message.includes('edit')) tool('edit', { path: 'a.txt', edits: [{ oldText: 'hello', newText: 'hi' }] }, { content: [{ type: 'text', text: 'Edited a.txt' }], details: { patch: '--- a.txt\n+++ a.txt\n@@ -3,1 +3,1 @@\n-hello\n+hi\n' } }, answer)
  else if (message.includes('read')) tool('read', { path: 'a.txt' }, { content: [{ type: 'text', text: 'hello' }] }, answer)
  else answer()
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let at
  while ((at = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, at)
    buffer = buffer.slice(at + 1)
    let m
    try {
      m = JSON.parse(line)
    } catch {
      continue
    }
    log({ command: m.type })
    switch (m.type) {
      case 'get_state':
        respond(m.id, 'get_state', { model, thinkingLevel: thinking, isStreaming: turn !== null, sessionId, sessionFile: `/tmp/fake-pi/${sessionId}.jsonl`, messageCount: 0 })
        break
      case 'get_available_models':
        respond(m.id, 'get_available_models', { models })
        break
      case 'get_commands':
        respond(m.id, 'get_commands', { commands: [{ name: 'review', description: 'Review the diff', source: 'prompt' }, { name: 'skill:lark', description: 'Lark', source: 'skill' }] })
        break
      case 'prompt':
        prompt(m.id, m.message + (m.images?.length ? ` [${m.images.length} image]` : ''))
        break
      case 'abort':
        respond(m.id, 'abort')
        // The dialogs' signal is aborted with the turn: nothing runs after it.
        dialogs.clear()
        if (turn) end('aborted')
        break
      case 'extension_ui_response': {
        const resolve = dialogs.get(m.id)
        dialogs.delete(m.id)
        resolve?.(m)
        break
      }
      default:
        out({ id: m.id, type: 'response', command: m.type, success: false, error: `Unknown command: ${m.type}` })
    }
  }
})
process.stdin.on('end', () => process.exit(0))
